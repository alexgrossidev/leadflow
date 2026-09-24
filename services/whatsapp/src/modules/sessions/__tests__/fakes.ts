import { vi } from "vitest";
import { CAPACITY_STATUSES, type SessionStore } from "../session.repo";
import type { ReleaseLock, SessionCoordinator } from "../session.coordination";
import { SessionService, type SessionServiceConfig, type SessionTransport } from "../session.service";
import type { NewSessionRow, SessionRow, SessionStatus } from "../session.table";

const PRE_CONNECTED: readonly SessionStatus[] = ["connecting", "qr_ready", "qr_scanned"];
const QR_WRITABLE: readonly SessionStatus[] = [...PRE_CONNECTED, "disconnected", "failed"];

/**
 * In-memory SessionStore that mirrors SessionRepository's SQL exactly: the same
 * guarded transitions, affected-row results, ON UPDATE updated_at, and fresh
 * copies on every read (a shared reference once hid a real bug: a re-read after
 * a write returned the written object, not what the database would hold).
 */
export class InMemorySessionRepository implements SessionStore {
  private readonly rows = new Map<number, SessionRow>();
  private nextId = 1;

  seed(row: Partial<SessionRow> & Pick<SessionRow, "businessId" | "userId">): SessionRow {
    const now = new Date();
    const full: SessionRow = {
      id: this.nextId++,
      status: "connecting",
      qrCode: null,
      qrExpiresAt: null,
      connectedAt: null,
      disconnectedAt: null,
      createdAt: now,
      updatedAt: now,
      ...row,
    };
    this.rows.set(full.id, full);
    return { ...full };
  }

  /** Direct read for assertions. */
  get(businessId: number, userId: number): SessionRow | undefined {
    const row = [...this.rows.values()].find((r) => r.businessId === businessId && r.userId === userId);
    return row ? { ...row } : undefined;
  }

  async findByBusinessAndUser(businessId: number, userId: number): Promise<SessionRow | null> {
    return this.get(businessId, userId) ?? null;
  }

  async create(input: NewSessionRow): Promise<SessionRow> {
    if (this.get(input.businessId, input.userId)) throw new Error("ER_DUP_ENTRY whatsapp_sessions_business_user_uq");
    const { id: _ignored, ...rest } = input;
    return this.seed({
      ...rest,
      status: rest.status ?? "connecting",
      qrCode: rest.qrCode ?? null,
      qrExpiresAt: rest.qrExpiresAt ?? null,
      connectedAt: rest.connectedAt ?? null,
      disconnectedAt: rest.disconnectedAt ?? null,
      createdAt: rest.createdAt ?? new Date(),
      updatedAt: rest.updatedAt ?? new Date(),
    });
  }

  async updateStatus(id: number, status: SessionStatus, onlyFrom?: readonly SessionStatus[]): Promise<boolean> {
    return this.update(id, onlyFrom ?? null, { status });
  }

  async updateQr(id: number, qrCode: string, qrExpiresAt: Date): Promise<void> {
    this.update(id, QR_WRITABLE, { qrCode, qrExpiresAt, status: "qr_ready" });
  }

  async resetToConnecting(id: number): Promise<void> {
    this.update(id, null, { status: "connecting", qrCode: null, qrExpiresAt: null, connectedAt: null, disconnectedAt: null });
  }

  async clearQr(id: number, status: SessionStatus): Promise<void> {
    this.update(id, PRE_CONNECTED, { qrCode: null, qrExpiresAt: null, status });
  }

  async setConnected(id: number): Promise<void> {
    this.update(id, PRE_CONNECTED, { status: "connected", connectedAt: new Date(), qrCode: null, qrExpiresAt: null });
  }

  async setDisconnected(id: number): Promise<boolean> {
    return this.update(id, CAPACITY_STATUSES, { status: "disconnected", disconnectedAt: new Date() });
  }

  async countActive(): Promise<number> {
    return [...this.rows.values()].filter((r) => (CAPACITY_STATUSES as readonly string[]).includes(r.status)).length;
  }

  /**
   * UPDATE ... WHERE id = ? [AND status IN (...)]. Returns whether a row
   * matched, as mysql2 reports affectedRows with the FOUND_ROWS flag it sets by default.
   */
  private update(id: number, onlyFrom: readonly SessionStatus[] | null, patch: Partial<SessionRow>): boolean {
    const row = this.rows.get(id);
    if (!row || (onlyFrom && !onlyFrom.includes(row.status))) return false;
    const next = { ...row, ...patch };
    const changed = (Object.keys(patch) as (keyof SessionRow)[]).some((k) => next[k] !== row[k]);
    if (changed) next.updatedAt = new Date(); // ON UPDATE CURRENT_TIMESTAMP
    this.rows.set(id, next);
    return true;
  }
}

/** In-memory SessionCoordinator with Redis-like TTL semantics, driven by Date.now(). */
export class InMemorySessionCoordinator implements SessionCoordinator {
  private readonly locks = new Set<string>();
  private readonly expiring = new Map<string, number>();
  private readonly qrFailures = new Map<string, number>();
  private capacityQueue: Promise<unknown> = Promise.resolve();

  async acquireInitLock(businessId: number, userId: number): Promise<ReleaseLock | null> {
    const key = `${businessId}:${userId}`;
    if (this.locks.has(key)) return null;
    this.locks.add(key);
    return async () => this.locks.delete(key);
  }

  withCapacityLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.capacityQueue.then(fn, fn);
    this.capacityQueue = run.catch(() => undefined);
    return run;
  }

  async recordActivity(businessId: number, userId: number, ttlMs: number): Promise<void> {
    this.expiring.set(`activity:${businessId}:${userId}`, Date.now() + ttlMs);
  }

  async activityRemainingMs(businessId: number, userId: number): Promise<number> {
    return Math.max(0, (this.expiring.get(`activity:${businessId}:${userId}`) ?? 0) - Date.now());
  }

  async incrementQrFailures(businessId: number, userId: number): Promise<number> {
    const key = `${businessId}:${userId}`;
    const next = (this.qrFailures.get(key) ?? 0) + 1;
    this.qrFailures.set(key, next);
    return next;
  }

  async resetQrFailures(businessId: number, userId: number): Promise<void> {
    this.qrFailures.delete(`${businessId}:${userId}`);
  }

  async claimQrRefresh(businessId: number, userId: number, cooldownMs: number): Promise<boolean> {
    const key = `qr-refresh:${businessId}:${userId}`;
    if ((this.expiring.get(key) ?? 0) > Date.now()) return false;
    this.expiring.set(key, Date.now() + cooldownMs);
    return true;
  }
}

export function fakeTransport() {
  return {
    initSession: vi.fn<SessionTransport["initSession"]>().mockResolvedValue(undefined),
    closeSession: vi.fn<SessionTransport["closeSession"]>().mockResolvedValue(undefined),
    clearSessionData: vi.fn<SessionTransport["clearSessionData"]>().mockResolvedValue(undefined),
  };
}

export function createTestService(config: Partial<SessionServiceConfig> = {}) {
  const repo = new InMemorySessionRepository();
  const coordinator = new InMemorySessionCoordinator();
  const transport = fakeTransport();
  const service = new SessionService(repo, coordinator, transport, {
    maxConcurrentSessions: 20,
    maxReconnectAttempts: 5,
    inactivityTimeoutMs: 1_800_000,
    reinitSettleMs: 0,
    ...config,
  });
  return { repo, coordinator, transport, service };
}
