import type { WhatsappClient } from "#transport/whatsapp.client";
import { UnrecoverableWhatsappError } from "#transport/whatsapp.errors";
import { logger } from "@leadflow/shared";
import { z } from "zod";
import type { SessionCallbackPayload, QrResponse, SessionService, SessionStatusResponse } from "./session.service";
import type { SessionRow } from "./session.table";

/**
 * Webhook body posted by wppconnect-server:
 * `{ event, session: "<businessId>_<userId>", ...event-specific fields }`.
 *
 *   qrcode          → "qr" (with `qrcode`, base64 PNG without the data: prefix)
 *   status-find     → mapped by `status` (isLogged/inChat, qrReadSuccess, disconnect reasons)
 *   session-logged  → "authenticated"
 *   qr-scanned      → "qr_scanned"
 *   disconnected, closesession, logoutsession → "disconnected"
 *   onmessage       → inbound message (only used to confirm the login)
 */
export const callbackBodySchema = z
  .object({
    event: z.string().min(1).max(64),
    session: z.string().regex(/^[1-9]\d{0,9}_[1-9]\d{0,9}$/, "session must be <businessId>_<userId>"),
    qrcode: z.string().optional(),
    status: z.string().max(64).optional(),
  })
  .loose();

export type WppconnectCallbackBody = z.infer<typeof callbackBodySchema>;

export type NormalisedCallbackEvent =
  | { kind: "session"; payload: SessionCallbackPayload }
  | { kind: "inbound_message"; businessId: number; userId: number }
  | { kind: "ignored" };

export interface HttpError {
  error: string;
  code: string;
  statusCode: number;
}

type ConnectionProbe = Pick<WhatsappClient, "getSessionStatus">;

const DISCONNECT_STATUSES = new Set(["disconnectedMobile", "autocloseCalled", "browserClose"]);
const CONNECTED_PROBE_VALUES = new Set<unknown>([true, "true", "CONNECTED", "isLogged", "inChat", "AUTHENTICATED"]);

export class SessionController {
  constructor(
    private readonly service: SessionService,
    private readonly probe: ConnectionProbe,
    /** Delay before double-checking the login after a QR scan; 0 disables the check. */
    private readonly postScanPollMs = 5_000,
  ) {}

  async initSession(businessId: number, userId: number): Promise<{ session: SessionRow } | { httpError: HttpError }> {
    try {
      return { session: await this.service.initSession(businessId, userId) };
    } catch (err) {
      if (err instanceof UnrecoverableWhatsappError) {
        const statusCode =
          err.code === "SESSION_LIMIT_EXCEEDED" || err.code === "SESSION_INIT_BUSY" ? 503
          : err.code === "SESSION_INIT_IN_PROGRESS" ? 409
          : 502;
        return { httpError: this.error(err.code, err.message, statusCode) };
      }
      logger.error({ err, businessId, userId }, "initSession failed");
      return { httpError: this.error("INTERNAL_ERROR", "Failed to initiate session", 500) };
    }
  }

  async getStatus(
    businessId: number,
    userId: number,
  ): Promise<{ status: SessionStatusResponse } | { httpError: HttpError }> {
    const status = await this.service.getStatus(businessId, userId);
    if (!status) return { httpError: this.error("SESSION_NOT_FOUND", "Session not found", 404) };
    return { status };
  }

  async getQr(businessId: number, userId: number): Promise<{ qr: QrResponse } | { httpError: HttpError }> {
    const current = await this.service.getStatus(businessId, userId);
    if (!current) {
      return { httpError: this.error("SESSION_NOT_FOUND", "Session not found; POST /sessions/:business_id/:user_id first", 404) };
    }

    switch (current.status) {
      case "connected":
        return { httpError: this.error("SESSION_ALREADY_CONNECTED", "Session is already connected; no QR needed", 409) };
      case "disconnected":
      case "failed":
      case "closed":
        return {
          httpError: this.error(
            "SESSION_NOT_ACTIVE",
            `Session is ${current.status}; POST /sessions/:business_id/:user_id to start a new one`,
            409,
          ),
        };
    }

    const qr = await this.service.getQr(businessId, userId);
    if (!qr) {
      return { httpError: this.error("QR_NOT_AVAILABLE", "QR code not available yet; retry in a few seconds", 404) };
    }
    return { qr };
  }

  async closeSession(businessId: number, userId: number): Promise<void | { httpError: HttpError }> {
    try {
      await this.service.closeSession(businessId, userId);
    } catch (err) {
      if (err instanceof UnrecoverableWhatsappError && err.code === "SESSION_NOT_FOUND") {
        return { httpError: this.error(err.code, err.message, 404) };
      }
      logger.error({ err, businessId, userId }, "closeSession failed");
      return { httpError: this.error("INTERNAL_ERROR", "Failed to close session", 500) };
    }
  }

  /** Translate a raw wppconnect webhook into the service's event model. */
  normaliseCallbackEvent(body: WppconnectCallbackBody): NormalisedCallbackEvent {
    const { event, session, qrcode, status } = body;
    const [businessId, userId] = session.split("_").map(Number) as [number, number];
    const toSession = (payload: Omit<SessionCallbackPayload, "businessId" | "userId">): NormalisedCallbackEvent => ({
      kind: "session",
      payload: { ...payload, businessId, userId },
    });

    logger.debug({ event, status, session }, "Webhook callback received");

    switch (event) {
      case "qrcode":
        if (!qrcode) return { kind: "ignored" };
        return toSession({ event: "qr", qr: qrcode.startsWith("data:") ? qrcode : `data:image/png;base64,${qrcode}` });

      case "qr-scanned":
        return toSession({ event: "qr_scanned" });

      case "session-logged":
      case "authenticated":
        return toSession({ event: "authenticated" });

      case "status-find":
        if (status === "isLogged" || status === "inChat") return toSession({ event: "authenticated" });
        if (status === "qrReadSuccess") {
          this.schedulePostScanCheck(businessId, userId);
          return toSession({ event: "qr_scanned" });
        }
        if (status && DISCONNECT_STATUSES.has(status)) {
          return toSession({ event: "disconnected", disconnectReason: status });
        }
        // notLogged, qrReadFail, qrReadError: nothing to do.
        return { kind: "ignored" };

      case "disconnected":
      case "desconnectedMobile": // upstream's own spelling
      case "closesession":
      case "logoutsession":
        return toSession({ event: "disconnected" });

      case "onMessage":
      case "onmessage":
        return { kind: "inbound_message", businessId, userId };

      default:
        return { kind: "ignored" };
    }
  }

  async handleSessionCallback(payload: SessionCallbackPayload): Promise<void> {
    await this.service.handleCallback(payload);
  }

  /**
   * An inbound message proves the session is logged in. If the isLogged webhook
   * was lost the session is still `qr_scanned`/`connecting`; promote it now.
   */
  async handleInboundMessage(businessId: number, userId: number): Promise<void> {
    try {
      const current = await this.service.getStatus(businessId, userId);
      if (!current) return;
      if (current.status === "qr_scanned" || current.status === "connecting") {
        logger.info({ businessId, userId }, "Inbound message on an unconfirmed session; marking connected");
        await this.service.handleCallback({ event: "authenticated", businessId, userId });
      } else if (current.status === "connected") {
        await this.service.recordActivity(businessId, userId);
      }
    } catch (err) {
      logger.warn({ businessId, userId, err }, "Failed to process inbound message webhook");
    }
  }

  /**
   * wppconnect occasionally never delivers the isLogged webhook after a scan,
   * so poll the transport once shortly afterwards as a fallback.
   */
  private schedulePostScanCheck(businessId: number, userId: number): void {
    if (this.postScanPollMs <= 0) return;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const status = await this.probe.getSessionStatus(businessId, userId);
          if (CONNECTED_PROBE_VALUES.has(status)) {
            await this.service.handleCallback({ event: "authenticated", businessId, userId });
          }
        } catch (err) {
          logger.warn({ businessId, userId, err }, "Post-scan connection check failed");
        }
      })();
    }, this.postScanPollMs);
    timer.unref();
  }

  private error(code: string, message: string, statusCode: number): HttpError {
    return { error: message, code, statusCode };
  }
}
