import { env } from "#config/env";
import {
  RetriableWhatsappError,
  UnrecoverableWhatsappError,
} from "./whatsapp.errors";

export interface TransportResponse {
  status?: string | boolean;
  response?: unknown;
  message?: string;
  error?: string;
  code?: string;
  fatal?: boolean;
}

export interface TransportOptions {
  baseUrl: string;
  secretKey: string;
  timeoutMs: number;
}

/** Error codes that should never be retried. */
export const FATAL_TRANSPORT_CODES = new Set([
  "INVALID_PHONE",
  "INVALID_PAYLOAD",
  "EMPTY_BODY",
  "UNSUPPORTED_ATTACHMENT",
  "ACCOUNT_UNAVAILABLE",
]);

/**
 * HTTP plumbing and bearer-token management for wppconnect-server.
 *
 * wppconnect-server authenticates admin calls with its SECRET_KEY as a URL path
 * segment. That is an upstream design constraint, so URLs built here must never
 * be logged or attached to errors; errors carry the endpoint name instead.
 */
export abstract class WhatsappTransportBase {
  private readonly tokenCache = new Map<string, string>();
  protected readonly options: TransportOptions;

  constructor(options: Partial<TransportOptions> = {}) {
    this.options = {
      baseUrl: (options.baseUrl ?? env.WHATSAPP_SERVER_URL).replace(/\/$/, ""),
      secretKey: options.secretKey ?? env.WA_TRANSPORT_SECRET_KEY,
      timeoutMs: options.timeoutMs ?? env.WHATSAPP_SEND_TIMEOUT_MS,
    };
  }

  /** Stable wppconnect session name for a (businessId, userId) pair. */
  protected sessionName(businessId: number, userId: number): string {
    return `${businessId}_${userId}`;
  }

  /**
   * Obtain (or reuse) a bearer token: POST /api/{session}/{secretKey}/generate-token.
   *
   * A 401 means a stale session with a different token exists in the transport's
   * token store; clear it with the unauthenticated clear-session-data endpoint and
   * retry once.
   */
  protected async getToken(businessId: number, userId: number, isRetry = false): Promise<string> {
    const session = this.sessionName(businessId, userId);
    const cached = this.tokenCache.get(session);
    if (cached) return cached;

    const response = await this.request(
      "generate-token",
      `/api/${session}/${this.options.secretKey}/generate-token`,
      { method: "POST" },
    );

    if (response.status === 401 && !isRetry) {
      await this.clearStaleSession(session);
      return this.getToken(businessId, userId, true);
    }

    const body = await this.parseResponse(response);
    if (!response.ok) this.throwTransportError(response.status, body, businessId, userId);

    // `token` is the bearer; `full` is "session:token" and only valid as a path param.
    const { token, full } = body as { token?: string; full?: string };
    const bearer = token ?? full?.split(":").slice(1).join(":");
    if (!bearer) {
      throw new RetriableWhatsappError("wppconnect-server returned no token", "TRANSPORT_INVALID_RESPONSE");
    }

    this.tokenCache.set(session, bearer);
    return bearer;
  }

  protected evictToken(businessId: number, userId: number): void {
    this.tokenCache.delete(this.sessionName(businessId, userId));
  }

  /**
   * Remove the transport's stored token/session data without a bearer token
   * (logout-session requires one; clear-session-data does not). Best-effort.
   */
  protected async clearStaleSession(session: string): Promise<void> {
    this.tokenCache.delete(session);
    try {
      await this.request(
        "clear-session-data",
        `/api/${session}/${this.options.secretKey}/clear-session-data`,
        { method: "POST" },
      );
    } catch {
      // A failed clear still lets the caller retry generate-token.
    }
  }

  /** Bearer headers; the JSON content type only when there is a body to describe. */
  protected async authHeaders(businessId: number, userId: number, withJsonBody = false): Promise<Record<string, string>> {
    const token = await this.getToken(businessId, userId);
    return {
      Authorization: `Bearer ${token}`,
      ...(withJsonBody ? { "Content-Type": "application/json" } : {}),
    };
  }

  /**
   * fetch with a timeout. `endpoint` is a log-safe label; `path` may contain the
   * secret key and is deliberately kept out of every error.
   */
  protected async request(
    endpoint: string,
    path: string,
    init: RequestInit,
    timeoutMs = this.options.timeoutMs,
  ): Promise<Response> {
    try {
      return await fetch(`${this.options.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new RetriableWhatsappError(
        timedOut ? "WhatsApp transport timed out" : "WhatsApp transport request failed",
        timedOut ? "TRANSPORT_TIMEOUT" : "TRANSPORT_REQUEST_FAILED",
        { endpoint },
      );
    }
  }

  protected async parseResponse(response: Response): Promise<TransportResponse> {
    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text) as TransportResponse;
    } catch {
      throw new RetriableWhatsappError(
        "WhatsApp transport returned invalid JSON",
        "TRANSPORT_INVALID_RESPONSE",
        { status: response.status },
      );
    }
  }

  protected throwTransportError(
    status: number,
    body: TransportResponse,
    businessId?: number,
    userId?: number,
  ): never {
    const message = body.error ?? body.message ?? "WhatsApp transport failed";

    // A stale cached token: evict so the next call re-authenticates.
    if (status === 401 && businessId !== undefined && userId !== undefined) {
      this.evictToken(businessId, userId);
    }

    // wppconnect answers 404 {status:"Disconnected"} when the session is not
    // running. That is a transient state (reconnect is in progress), not a bad request.
    if (body.status === "Disconnected") {
      throw new RetriableWhatsappError(message, "SESSION_DISCONNECTED");
    }

    const code = body.code ?? `HTTP_${status}`;
    if (body.fatal || FATAL_TRANSPORT_CODES.has(code) || (status >= 400 && status < 500)) {
      throw new UnrecoverableWhatsappError(message, code);
    }
    throw new RetriableWhatsappError(message, code);
  }
}
