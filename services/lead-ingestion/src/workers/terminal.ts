import type { JobContext } from "@leadflow/shared/queue";
import { logger } from "#core/logger";

export interface TerminalPolicy<T> {
  /** Must equal the `attempts` the job was enqueued with. */
  maxAttempts: number;
  /** A fatal failure is terminal on the spot: retrying cannot change the outcome. */
  isFatal(err: unknown): boolean;
  /** Durable hand-off for a job that will not be retried again. */
  onTerminal(data: T, err: unknown, fatal: boolean): Promise<void>;
}

/**
 * Runs a job body so that its last failure is never lost in BullMQ's failed
 * set: a fatal error, or a transient one on the final attempt, is handed to
 * `onTerminal` (dead-letter table, reconnect prompt, ...).
 *
 * Fatal jobs then complete normally (no point burning the remaining retries);
 * exhausted ones rethrow so BullMQ records the failure too. If the hand-off
 * itself fails, the original error is rethrown so the job stays failed and
 * visible rather than silently completing.
 */
export async function runWithTerminalHandling<T>(
  job: JobContext<T>,
  policy: TerminalPolicy<T>,
  body: () => Promise<void>,
): Promise<void> {
  try {
    await body();
  } catch (err) {
    const fatal = policy.isFatal(err);
    // attemptsMade is incremented after the attempt, so it is 0-based here:
    // the final attempt is the one where attemptsMade + 1 === maxAttempts.
    const exhausted = job.attemptsMade + 1 >= policy.maxAttempts;
    if (!fatal && !exhausted) throw err;

    try {
      await policy.onTerminal(job.data, err, fatal);
    } catch (handoffErr) {
      logger.error(
        {
          err: handoffErr,
          cause: err instanceof Error ? err.message : String(err),
          queue: job.name,
          jobId: job.id,
        },
        "Terminal hand-off failed; leaving the job failed in BullMQ",
      );
      throw err;
    }
    if (!fatal) throw err;
  }
}
