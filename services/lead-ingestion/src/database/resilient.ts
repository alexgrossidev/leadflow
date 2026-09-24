import { logger } from "#core/logger";
import { dbErrorCode } from "./errors";

/**
 * Error codes that indicate the connection itself was lost, typically a stale
 * socket reaped by the server during inactivity. Most fire before the statement
 * reaches the server, but ECONNRESET/ETIMEDOUT can also fire after it was sent,
 * when the outcome is unknown. That is why {@link withDbRetry} is reserved for
 * reads and idempotent writes. Lock/deadlock codes are deliberately absent:
 * those are retried at the job level, where the whole step re-runs.
 */
const TRANSIENT_CONNECTION_CODES = new Set<string>([
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_SEQUENCE_TIMEOUT",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNREFUSED",
  "ER_CON_COUNT_ERROR",
]);

/** Reads the code through Drizzle's wrapper and our DatabaseError alike. */
const isTransientConnectionError = (error: unknown): boolean => {
  const code = dbErrorCode(error);
  return !!code && TRANSIENT_CONNECTION_CODES.has(code);
};

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  label?: string;
}

/**
 * Runs a DB operation, retrying with exponential backoff only when the failure
 * is a transient connection loss (see {@link TRANSIENT_CONNECTION_CODES}). Any
 * other error propagates immediately.
 *
 * Use for reads and for connection-acquisition paths. Do not wrap
 * non-idempotent writes unless they are guarded by a unique constraint / are
 * otherwise safe to replay.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  { retries = 2, baseDelayMs = 100, label = "db-operation" }: RetryOptions = {},
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientConnectionError(error) || attempt >= retries) {
        throw error;
      }
      const backoff = baseDelayMs * 2 ** attempt;
      attempt += 1;
      logger.warn(
        {
          label,
          attempt,
          code: dbErrorCode(error),
          backoffMs: backoff,
        },
        "Transient DB connection error; retrying",
      );
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}
