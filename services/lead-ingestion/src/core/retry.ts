/**
 * One place that decides "is this failure worth retrying?", shared by every
 * dispatcher and worker so the lead, token and refresh flows can't drift apart.
 */

/** Socket-level failures: the request may never have reached the peer. */
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  // MySQL connection loss (see database/resilient.ts)
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ER_CON_COUNT_ERROR",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
]);

/**
 * Graph API error codes that mean "throttled or temporarily unavailable". Meta
 * returns most of these with HTTP 400, so a status-only rule would treat rate
 * limiting as a permanent failure and dead-letter perfectly good leads.
 * https://developers.facebook.com/docs/graph-api/guides/error-handling
 */
const GRAPH_TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

interface ErrorShape {
  status?: unknown;
  code?: unknown;
  graphError?: { code?: unknown };
  cause?: unknown;
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

/**
 * Walks the `cause` chain (bounded) and returns true if any link is transient:
 * a 5xx/408/429 response, a Graph throttling code, or a network/connection
 * error code. Everything else (4xx, validation, programming errors) is final.
 */
export function isRetryableError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const e = current as ErrorShape;
    const graphCode = e.graphError?.code;
    if (typeof graphCode === "number" && GRAPH_TRANSIENT_CODES.has(graphCode)) {
      return true;
    }
    if (typeof e.status === "number") return isRetryableStatus(e.status);
    if (typeof e.code === "string" && NETWORK_CODES.has(e.code)) return true;
    current = e.cause;
  }
  return false;
}
