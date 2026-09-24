/** Rows per SQL statement for bulk target writes. */
export const BATCH_SIZE = 250;

/** Rows moved per transaction by the pause sweep, the restore and the purge. */
export const CLEANUP_BATCH_SIZE = 1000;

/** Why a target was moved to skipped_actions. */
export const SKIP_REASONS = {
  PAUSE: "PAUSE",
} as const;

export type SkipReason = (typeof SKIP_REASONS)[keyof typeof SKIP_REASONS];

/** Lets in-flight execution jobs observe the pause before targets are swept. */
export const PAUSE_SWEEP_DELAY_MS = 20_000;

/** Lets in-flight jobs drain before a deleted automation's rows are purged. */
export const DELETE_GRACE_MS = 15 * 60_000;

/** Upper bound for streaming a whole business's leads during a backfill. */
export const BACKFILL_DEADLINE_MS = 5 * 60_000;
