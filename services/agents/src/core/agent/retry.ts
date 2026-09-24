import { AGENT_ERROR_CODES, AgentError } from "./agent.errors.js";
import type { TokenUsage } from "./llm.port.js";

/**
 * Retry must be worthwhile *and* safe.
 *
 * Worthwhile: only a provider failure the adapter classified as transient (429,
 * 5xx/overloaded, dropped connection, request timeout). Refusals, truncation,
 * budget and iteration caps, misconfiguration, tool failures and anything
 * unrecognised are final; retrying them burns budget for the same result.
 *
 * Safe: never once a side-effecting tool has succeeded. A run is replayed from
 * the start, so a retry after `respond_whatsapp` went out would message the
 * customer a second time. Read-only tools do not set `mutated`, so a run that
 * only parsed or looked something up stays retryable.
 *
 * Tool failures are deliberately not retried even when they look transient: a
 * gateway timeout is ambiguous (the message may have been delivered), and a
 * duplicate reply is worse than a missing one that the failed status surfaces.
 */
export const shouldRetry = (error: unknown): boolean =>
  error instanceof AgentError &&
  error.code === AGENT_ERROR_CODES.providerFailed &&
  error.retryable &&
  !error.mutated;

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** The run's overall deadline; no retry starts, and no backoff outlasts it. */
  signal?: AbortSignal;
  /** Called before each backoff; for logging. */
  onRetry?: (error: AgentError, attempt: number, delayMs: number) => void;
  /** Injectable for tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface RetryResult<T> {
  value: T;
  attempts: number;
}

/**
 * Exponential backoff with full jitter: a uniformly random delay in
 * [0, min(max, base * 2^n)). Jitter spreads out a burst of runs that all hit
 * the same 429 so they don't retry in lockstep.
 */
export const backoffDelay = (
  retryIndex: number,
  options: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs" | "random">,
): number => {
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** retryIndex);
  return Math.floor((options.random ?? Math.random)() * ceiling);
};

const abortableSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Runs `attempt` until it succeeds, fails non-retryably, or the attempt budget
 * or deadline is spent. Usage from failed attempts is accumulated onto the
 * final error or result, so a retried run still reports everything it cost.
 */
export const withRetry = async <T extends { usage: TokenUsage }>(
  attempt: (attemptNumber: number) => Promise<T>,
  options: RetryOptions,
): Promise<RetryResult<T>> => {
  const sleep = options.sleep ?? abortableSleep;
  const spent: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  for (let attemptNumber = 1; ; attemptNumber++) {
    try {
      const value = await attempt(attemptNumber);
      value.usage = sumUsage(value.usage, spent);
      return { value, attempts: attemptNumber };
    } catch (error) {
      if (error instanceof AgentError) {
        error.usage = sumUsage(error.usage, spent);
        Object.assign(spent, error.usage);
      }
      if (!shouldRetry(error) || attemptNumber >= options.attempts) throw error;
      if (options.signal?.aborted) throw error;

      const delay = backoffDelay(attemptNumber - 1, options);
      options.onRetry?.(error as AgentError, attemptNumber, delay);
      try {
        await sleep(delay, options.signal);
      } catch {
        // The deadline fired during backoff: report the failure that caused
        // the wait, not the abort.
        throw error;
      }
    }
  }
};

const sumUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: (a.cacheReadTokens ?? 0) + (b.cacheReadTokens ?? 0),
  cacheWriteTokens: (a.cacheWriteTokens ?? 0) + (b.cacheWriteTokens ?? 0),
});
