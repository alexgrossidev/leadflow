import { isAxiosError } from "axios";

/** Facebook's error envelope (`{ error: { message, type, code, ... } }`). */
export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
}

/**
 * An outbound HTTP failure, stripped to what is safe to log.
 *
 * An AxiosError carries the whole exchange on `config`: for Graph calls that is
 * `access_token`, `client_secret`, `fb_exchange_token` and the OAuth `code` in
 * `config.params`; for gateway calls it is the lead's PII in the body and the
 * service token header. Any logger that walks the error would write all of it
 * to disk. This keeps the diagnosable parts (target, route without query,
 * status, network code, Graph error code and message) and deliberately does not
 * retain the original error, not even as `cause`.
 */
export class ExternalHttpError extends Error {
  constructor(
    readonly target: string,
    readonly route: string,
    /** HTTP status, or undefined when no response arrived (network failure). */
    readonly status: number | undefined,
    /** Network-level code such as ECONNRESET or ECONNABORTED. */
    readonly code: string | undefined,
    readonly graphError?: GraphErrorBody,
  ) {
    const reason = status ?? code ?? "no response";
    const detail = graphError?.message
      ? ` (${graphError.code ?? "?"}: ${graphError.message.slice(0, 200)})`
      : "";
    super(`${target} ${route} failed: ${reason}${detail}`);
    this.name = "ExternalHttpError";
  }
}

/** Path only: query strings on Graph calls can carry tokens. */
function routeOf(method: string | undefined, url: string | undefined): string {
  const path = (url ?? "?").split("?")[0];
  return `${method?.toUpperCase() ?? "?"} ${path}`;
}

function graphErrorOf(data: unknown): GraphErrorBody | undefined {
  const err = (data as { error?: unknown } | undefined)?.error;
  if (!err || typeof err !== "object") return undefined;
  const e = err as Record<string, unknown>;
  return {
    message: typeof e.message === "string" ? e.message : undefined,
    type: typeof e.type === "string" ? e.type : undefined,
    code: typeof e.code === "number" ? e.code : undefined,
    error_subcode:
      typeof e.error_subcode === "number" ? e.error_subcode : undefined,
  };
}

/** Convert an axios failure into a redacted {@link ExternalHttpError}; pass anything else through. */
export function toExternalHttpError(target: string, error: unknown): unknown {
  if (!isAxiosError(error)) return error;
  return new ExternalHttpError(
    target,
    routeOf(error.config?.method, error.config?.url),
    error.response?.status,
    error.code,
    graphErrorOf(error.response?.data),
  );
}
