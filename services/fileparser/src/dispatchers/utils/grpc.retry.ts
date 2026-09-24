import { logger } from "#core/logger";

/** grpc.status.UNAVAILABLE: the channel is down or the server is restarting. */
export const GRPC_UNAVAILABLE = 14;

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injectable for tests. */
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const DEFAULTS: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 10_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

function grpcCode(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    return typeof code === "number" ? code : undefined;
  }
  return undefined;
}

/**
 * Retries `fn` only while the gateway is UNAVAILABLE, with capped exponential
 * backoff and jitter. Every other failure (a rejected batch, INTERNAL,
 * DEADLINE_EXCEEDED) is rethrown at once: those are not transport blips, and
 * the job-level retry, which resumes from undelivered rows, handles them.
 */
export async function withGrpcRetry<T>(
  fn: () => Promise<T>,
  context: Record<string, unknown>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, sleep, random } = {
    ...DEFAULTS,
    ...options,
  };

  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (grpcCode(error) !== GRPC_UNAVAILABLE || attempt >= maxAttempts) {
        throw error;
      }
      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayMs = Math.round(backoff / 2 + random() * (backoff / 2));
      logger.warn(
        { ...context, attempt, maxAttempts, delayMs },
        "gRPC UNAVAILABLE; retrying after backoff",
      );
      await sleep(delayMs);
    }
  }
}
