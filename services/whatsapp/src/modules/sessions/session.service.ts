import { env } from "#config/env";
import { whatsappClient, type WhatsappClient } from "#transport/whatsapp.client";
import { UnrecoverableWhatsappError } from "#transport/whatsapp.errors";
import { logger } from "@leadflow/shared";
import { CAPACITY_STATUSES, SessionRepository, type SessionStore } from "./session.repo";
import { RedisSessionCoordinator, type SessionCoordinator } from "./session.coordination";
import type { SessionRow, SessionStatus } from "./session.table";
import {
  ACTIVE_STATUSES,
  FRESH_INIT_WINDOW_MS,
  LOCK_INIT_TTL_SECONDS,
  QR_FAILURE_WINDOW_SECONDS,
  QR_MAX_REFRESH_FAILURES,
  QR_REFRESH_COOLDOWN_MS,
  QR_TTL_SECONDS,
  RECONNECT_BACKOFF_CAP_MS,
  REINIT_SETTLE_MS,
} from "./session.constants";

export interface SessionCallbackPayload {
  event: "qr" | "qr_scanned" | "authenticated" | "disconnected";
  businessId: number;
  userId: number;
  /** Base64-encoded QR image, present when event = "qr". */
  qr?: string;
  /**
   * Present when event = "disconnected". "disconnectedMobile" and
   * "autocloseCalled" are deliberate logouts and must not auto-reconnect.
   */
  disconnectReason?: string;
}

export interface QrResponse {
  qr: string;
  expiresIn: number;
}

export interface SessionStatusResponse {
  status: SessionStatus;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}

export type SessionTransport = Pick<WhatsappClient, "initSession" | "closeSession" | "clearSessionData">;

export interface SessionServiceConfig {
  maxConcurrentSessions: number;
  maxReconnectAttempts: number;
  inactivityTimeoutMs: number;
  reinitSettleMs: number;
}

const DELIBERATE_LOGOUT_REASONS = new Set(["disconnectedMobile", "autocloseCalled"]);

/**
 * Drives the per-tenant WhatsApp session state machine:
 *
 *   connecting → qr_ready → qr_scanned → connected → disconnected → (reconnect) → connecting
 *                                                   ↘ failed / closed
 *
 * The database row is the source of truth; transitions are conditional UPDATEs
 * (see SessionRepository). Locks, counters and activity markers live in Redis
 * (SessionCoordinator) so every replica sees the same state. The only
 * per-process state is the inactivity timer, which re-checks Redis before
 * closing anything.
 */
export class SessionService {
  private readonly config: SessionServiceConfig;
  private readonly inactivityTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly repo: SessionStore,
    private readonly coordinator: SessionCoordinator,
    private readonly transport: SessionTransport,
    config: Partial<SessionServiceConfig> = {},
  ) {
    this.config = {
      maxConcurrentSessions: config.maxConcurrentSessions ?? env.WHATSAPP_MAX_CONCURRENT_SESSIONS,
      maxReconnectAttempts: config.maxReconnectAttempts ?? env.WHATSAPP_SESSION_MAX_RECONNECT_ATTEMPTS,
      inactivityTimeoutMs: config.inactivityTimeoutMs ?? env.WHATSAPP_SESSION_INACTIVITY_TIMEOUT_MS,
      reinitSettleMs: config.reinitSettleMs ?? REINIT_SETTLE_MS,
    };
  }

  /**
   * Start (or restart) the WhatsApp session for (businessId, userId).
   *
   * The row is upserted before the transport is called, because the qrcode
   * webhook can arrive before start-session even returns and would otherwise be
   * dropped as "unknown session".
   */
  async initSession(businessId: number, userId: number): Promise<SessionRow> {
    const release = await this.coordinator.acquireInitLock(businessId, userId, LOCK_INIT_TTL_SECONDS);
    if (!release) {
      throw new UnrecoverableWhatsappError(
        "Session init already in progress for this (businessId, userId)",
        "SESSION_INIT_IN_PROGRESS",
      );
    }

    try {
      const existing = await this.repo.findByBusinessAndUser(businessId, userId);

      // After a mobile logout the session object inside wppconnect is half torn
      // down and close-session crashes, so wipe its data instead.
      if (existing && (ACTIVE_STATUSES as readonly string[]).includes(existing.status)) {
        try {
          await this.transport.clearSessionData(businessId, userId);
          await this.sleep(this.config.reinitSettleMs);
        } catch (err) {
          logger.warn({ businessId, userId, err }, "Could not clear transport session data; continuing with re-init");
        }
      }

      const session = await this.coordinator.withCapacityLock(() => this.claimSlot(businessId, userId, existing));

      await this.transport.initSession(businessId, userId);
      logger.info({ businessId, userId, sessionId: session.id }, "WhatsApp session initiated; waiting for QR webhook");

      await this.recordActivity(businessId, userId);
      return session;
    } finally {
      if (!(await release())) {
        logger.warn({ businessId, userId }, "Session init outlived its lock TTL");
      }
    }
  }

  /** Process a lifecycle webhook, already normalised by the controller. */
  async handleCallback(payload: SessionCallbackPayload): Promise<void> {
    const { event, businessId, userId } = payload;

    const session = await this.repo.findByBusinessAndUser(businessId, userId);
    if (!session) {
      logger.warn({ event, businessId, userId }, "Callback for unknown session ignored");
      return;
    }

    switch (event) {
      case "qr": {
        if (!payload.qr) {
          logger.warn({ businessId, userId }, "QR callback without a QR ignored");
          return;
        }
        const qrExpiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000);
        await this.repo.updateQr(session.id, payload.qr, qrExpiresAt);
        logger.info({ businessId, userId, sessionId: session.id }, "QR code stored");
        return;
      }

      case "qr_scanned": {
        await this.repo.clearQr(session.id, "qr_scanned");
        await this.coordinator.resetQrFailures(businessId, userId);
        logger.info({ businessId, userId, sessionId: session.id }, "QR scanned; waiting for login");
        return;
      }

      case "authenticated": {
        // A reconnect keeps connectedAt and legitimately resumes without a QR,
        // so the guard only applies to rows freshly reset by initSession.
        const msSinceUpdate = Date.now() - session.updatedAt.getTime();
        const freshInit = session.status === "connecting" && session.connectedAt === null;
        if (freshInit && msSinceUpdate < FRESH_INIT_WINDOW_MS) {
          logger.warn(
            { businessId, userId, sessionId: session.id, msSinceUpdate },
            "Ignoring cached-browser login webhook right after re-init",
          );
          return;
        }

        await this.repo.setConnected(session.id);
        await this.coordinator.resetQrFailures(businessId, userId);
        await this.recordActivity(businessId, userId);
        logger.info({ businessId, userId, sessionId: session.id }, "WhatsApp session connected");
        return;
      }

      case "disconnected": {
        const reason = payload.disconnectReason;
        // Compare-and-set against the state *before* this event: only the first
        // disconnect webhook for a live session gets to decide what happens next.
        const firstForThisDisconnect = await this.repo.setDisconnected(session.id);
        if (!firstForThisDisconnect) {
          logger.info(
            { businessId, userId, sessionId: session.id, reason, status: session.status },
            "Disconnect webhook for a session that is not live; already handled",
          );
          return;
        }

        if (reason && DELIBERATE_LOGOUT_REASONS.has(reason)) {
          logger.warn({ businessId, userId, sessionId: session.id, reason }, "Session logged out; not reconnecting");
          return;
        }

        logger.warn({ businessId, userId, sessionId: session.id, reason }, "Session dropped; scheduling reconnect");
        void this.reconnect(businessId, userId).catch((err: unknown) =>
          logger.error({ businessId, userId, err }, "Reconnect loop crashed"),
        );
        return;
      }
    }
  }

  /**
   * Restart a dropped session with exponential backoff. Stops as soon as the
   * session is no longer `disconnected` (re-initiated or closed meanwhile) and
   * marks it `failed` once the attempts are exhausted.
   */
  async reconnect(businessId: number, userId: number): Promise<void> {
    const maxAttempts = this.config.maxReconnectAttempts;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.sleep(Math.min(1000 * 2 ** (attempt - 1), RECONNECT_BACKOFF_CAP_MS));

      const session = await this.repo.findByBusinessAndUser(businessId, userId);
      if (session?.status !== "disconnected") {
        logger.info({ businessId, userId, status: session?.status }, "Session changed state; reconnect abandoned");
        return;
      }

      try {
        await this.transport.initSession(businessId, userId);
        await this.repo.updateStatus(session.id, "connecting", ["disconnected"]);
        logger.info({ businessId, userId, attempt }, "Reconnect accepted by transport");
        return;
      } catch (err) {
        logger.warn({ businessId, userId, attempt, maxAttempts, err }, "Reconnect attempt failed");
      }
    }

    const session = await this.repo.findByBusinessAndUser(businessId, userId);
    if (session) await this.repo.updateStatus(session.id, "failed", ["disconnected"]);
    logger.error({ businessId, userId, maxAttempts }, "Reconnect attempts exhausted; session marked failed");
  }

  /** Close a session deliberately (DELETE route, number removed, or inactivity). */
  async closeSession(businessId: number, userId: number): Promise<void> {
    const session = await this.repo.findByBusinessAndUser(businessId, userId);
    if (!session) {
      throw new UnrecoverableWhatsappError("Session not found", "SESSION_NOT_FOUND");
    }

    // Mark closed first: the transport fires disconnect webhooks while closing,
    // and those must see a non-live session rather than trigger a reconnect.
    await this.repo.updateStatus(session.id, "closed");
    this.clearInactivityTimer(businessId, userId);

    try {
      await this.transport.closeSession(businessId, userId);
    } catch (err) {
      logger.warn({ businessId, userId, err }, "Transport close failed; session is closed locally");
    }

    logger.info({ businessId, userId, sessionId: session.id }, "WhatsApp session closed");
  }

  async getStatus(businessId: number, userId: number): Promise<SessionStatusResponse | null> {
    const session = await this.repo.findByBusinessAndUser(businessId, userId);
    if (!session) return null;
    return { status: session.status, connectedAt: session.connectedAt, disconnectedAt: session.disconnectedAt };
  }

  /**
   * Current QR and its remaining lifetime. When it has expired, ask the
   * transport for a new one (at most once per cooldown) and return null: the
   * new QR arrives by webhook and the caller polls again.
   */
  async getQr(businessId: number, userId: number): Promise<QrResponse | null> {
    const session = await this.repo.findByBusinessAndUser(businessId, userId);
    if (!session) return null;

    const now = Date.now();
    if (session.qrCode && session.qrExpiresAt && session.qrExpiresAt.getTime() > now) {
      return { qr: session.qrCode, expiresIn: Math.floor((session.qrExpiresAt.getTime() - now) / 1000) };
    }

    const claimed = await this.coordinator.claimQrRefresh(businessId, userId, QR_REFRESH_COOLDOWN_MS);
    if (claimed) await this.refreshQr(session);
    return null;
  }

  /**
   * Record outbound/inbound activity: refreshes the shared activity marker and
   * (re)arms this process's inactivity timer.
   */
  async recordActivity(businessId: number, userId: number): Promise<void> {
    await this.coordinator.recordActivity(businessId, userId, this.config.inactivityTimeoutMs);
    this.scheduleInactivityCheck(businessId, userId, this.config.inactivityTimeoutMs);
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Runs under the global capacity lock: check the cap, then take the slot. */
  private async claimSlot(businessId: number, userId: number, existing: SessionRow | null): Promise<SessionRow> {
    const alreadyHoldsSlot = existing !== null && (CAPACITY_STATUSES as readonly string[]).includes(existing.status);

    if (!alreadyHoldsSlot) {
      const activeCount = await this.repo.countActive();
      if (activeCount >= this.config.maxConcurrentSessions) {
        throw new UnrecoverableWhatsappError(
          `Maximum concurrent sessions reached (${this.config.maxConcurrentSessions})`,
          "SESSION_LIMIT_EXCEEDED",
        );
      }
    }

    if (!existing) return this.repo.create({ businessId, userId, status: "connecting" });

    await this.repo.resetToConnecting(existing.id);
    const reset = await this.repo.findByBusinessAndUser(businessId, userId);
    if (!reset) throw new Error("Session row disappeared during re-init");
    return reset;
  }

  private async refreshQr(session: SessionRow): Promise<void> {
    const { businessId, userId, id: sessionId } = session;
    try {
      await this.transport.initSession(businessId, userId);
      await this.coordinator.resetQrFailures(businessId, userId);
      logger.info({ businessId, userId, sessionId }, "QR refresh requested from transport");
    } catch (err) {
      const failures = await this.coordinator.incrementQrFailures(businessId, userId, QR_FAILURE_WINDOW_SECONDS);
      logger.warn({ businessId, userId, sessionId, failures, err }, "QR refresh failed");

      if (failures >= QR_MAX_REFRESH_FAILURES) {
        await this.repo.updateStatus(sessionId, "failed");
        await this.coordinator.resetQrFailures(businessId, userId);
        logger.error({ businessId, userId, sessionId, failures }, "Session marked failed after repeated QR refresh failures");
      }
    }
  }

  private scheduleInactivityCheck(businessId: number, userId: number, delayMs: number): void {
    this.clearInactivityTimer(businessId, userId);
    const timer = setTimeout(() => {
      this.inactivityTimers.delete(this.timerKey(businessId, userId));
      void this.closeIfInactive(businessId, userId).catch((err: unknown) =>
        logger.error({ businessId, userId, err }, "Inactivity check failed"),
      );
    }, delayMs);
    timer.unref();
    this.inactivityTimers.set(this.timerKey(businessId, userId), timer);
  }

  /**
   * The timer is local but activity is shared: another replica may have sent
   * a message since this timer was armed, in which case the marker in Redis is
   * still alive and we simply wait out its remaining TTL.
   */
  private async closeIfInactive(businessId: number, userId: number): Promise<void> {
    const remainingMs = await this.coordinator.activityRemainingMs(businessId, userId);
    if (remainingMs > 0) {
      this.scheduleInactivityCheck(businessId, userId, remainingMs);
      return;
    }

    const session = await this.repo.findByBusinessAndUser(businessId, userId);
    if (!session || session.status === "closed" || session.status === "failed") return;

    logger.info({ businessId, userId }, "Closing WhatsApp session after inactivity timeout");
    await this.closeSession(businessId, userId);
  }

  private clearInactivityTimer(businessId: number, userId: number): void {
    const key = this.timerKey(businessId, userId);
    const existing = this.inactivityTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.inactivityTimers.delete(key);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private timerKey(businessId: number, userId: number): string {
    return `${businessId}:${userId}`;
  }
}

export const sessionService = new SessionService(
  new SessionRepository(),
  new RedisSessionCoordinator(),
  whatsappClient,
);
