import type { WhatsappProcessPayload } from "@leadflow/shared";
import { UnrecoverableWhatsappError } from "./whatsapp.errors";
import { WhatsappTransportBase } from "./whatsapp.transport.base";

export interface WhatsappSendResult {
  providerMessageId?: string;
}

export type SessionConnectionStatus = string | boolean;

/**
 * Pull the WhatsApp message id out of a send-message response.
 *
 * Upstream wppconnect-server returns `response` as an array of sent messages
 * (one per recipient); some forks return a single object. The id itself is
 * normally a string ("true_<jid>_<hash>") but older builds serialise it as
 * `{ _serialized }`. Anything else yields undefined rather than a bogus id.
 */
export function extractProviderMessageId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const response = (body as { response?: unknown }).response;
  const first: unknown = Array.isArray(response) ? response[0] : response;
  if (!first || typeof first !== "object") return undefined;

  const id = (first as { id?: unknown }).id;
  if (typeof id === "string" && id.length > 0) return id;
  if (id && typeof id === "object") {
    const serialized = (id as { _serialized?: unknown })._serialized;
    if (typeof serialized === "string" && serialized.length > 0) return serialized;
  }
  return undefined;
}

/**
 * Client for the subset of the wppconnect-server REST API this service uses.
 * dev/fake-transport.ts implements exactly these endpoints.
 */
export class WhatsappClient extends WhatsappTransportBase {
  /** POST /api/{session}/start-session. The QR arrives later via webhook. */
  async initSession(businessId: number, userId: number): Promise<void> {
    const session = this.sessionName(businessId, userId);
    const response = await this.request("start-session", `/api/${session}/start-session`, {
      method: "POST",
      headers: await this.authHeaders(businessId, userId, true),
      body: JSON.stringify({ waitQrCode: false }),
    });

    if (!response.ok) {
      this.throwTransportError(response.status, await this.parseResponse(response), businessId, userId);
    }
  }

  /** GET /api/{session}/check-connection-session. */
  async getSessionStatus(businessId: number, userId: number): Promise<SessionConnectionStatus> {
    const session = this.sessionName(businessId, userId);
    const response = await this.request(
      "check-connection-session",
      `/api/${session}/check-connection-session`,
      { method: "GET", headers: await this.authHeaders(businessId, userId) },
    );

    const body = await this.parseResponse(response);
    if (!response.ok) this.throwTransportError(response.status, body, businessId, userId);

    // Upstream returns `{status: true}`; some versions wrap it in `response`.
    const wrapped = body.response as { status?: SessionConnectionStatus } | undefined;
    return wrapped?.status ?? body.status ?? "unknown";
  }

  /** POST /api/{session}/close-session. */
  async closeSession(businessId: number, userId: number): Promise<void> {
    const session = this.sessionName(businessId, userId);
    const response = await this.request("close-session", `/api/${session}/close-session`, {
      method: "POST",
      headers: await this.authHeaders(businessId, userId),
    });

    if (!response.ok) {
      this.throwTransportError(response.status, await this.parseResponse(response), businessId, userId);
    }
    this.evictToken(businessId, userId);
  }

  /**
   * Wipe the transport's data for a session without a bearer token. Used before
   * re-initialising after a logout: close-session crashes upstream when the
   * session object inside wppconnect is already half torn down.
   */
  async clearSessionData(businessId: number, userId: number): Promise<void> {
    await this.clearStaleSession(this.sessionName(businessId, userId));
  }

  /** POST /api/{session}/send-message (plain text). */
  async send(payload: WhatsappProcessPayload): Promise<WhatsappSendResult> {
    if (!payload.recipientPhone.trim()) {
      throw new UnrecoverableWhatsappError("Missing recipient phone", "INVALID_PHONE");
    }
    if (!payload.content.body.trim()) {
      throw new UnrecoverableWhatsappError("Missing message body", "EMPTY_BODY");
    }

    const session = this.sessionName(payload.businessId, payload.userId);
    const response = await this.request("send-message", `/api/${session}/send-message`, {
      method: "POST",
      headers: await this.authHeaders(payload.businessId, payload.userId, true),
      body: JSON.stringify({
        phone: payload.recipientPhone,
        message: payload.content.body,
        isGroup: false,
      }),
    });

    const body = await this.parseResponse(response);
    if (!response.ok || body.status === "Error" || body.status === "error") {
      this.throwTransportError(response.status, body, payload.businessId, payload.userId);
    }

    const providerMessageId = extractProviderMessageId(body);
    return providerMessageId ? { providerMessageId } : {};
  }

  /** GET /healthz with a short timeout, so a hung transport cannot stall /health. */
  async healthCheck(timeoutMs = 2_000): Promise<boolean> {
    try {
      const response = await this.request("healthz", "/healthz", { method: "GET" }, timeoutMs);
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const whatsappClient = new WhatsappClient();
