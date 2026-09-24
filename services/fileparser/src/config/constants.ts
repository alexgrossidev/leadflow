/** Lifecycle of one import job, persisted in `import_status`. */
export const importStatus = {
  /** Reserved for producers that register a job before staging starts. */
  PENDING: "pending",
  /** The file is being parsed into `import_staging`. */
  INPROGRESS: "progress",
  /** Every row is staged; delivery to the gateway can start or resume. */
  COMPLETE: "complete",
  /** Every staged row was delivered to the gateway. */
  PROCESSED: "processed",
  /** Terminal failure; `fail_reason` says why. */
  FAIL: "fail",
} as const;

export type ImportStatusValue = (typeof importStatus)[keyof typeof importStatus];

/** Per-row delivery state in `import_staging`. */
export const stagingRowStatus = {
  RAW: "RAW",
  DELIVERED: "DELIVERED",
} as const;

export type StagingRowStatus =
  (typeof stagingRowStatus)[keyof typeof stagingRowStatus];

/**
 * Attempts BullMQ makes for each job. Both values match the queue provider
 * default (3); the handlers need them to tell a retryable failure from the
 * final one, because only the final one is reported to the user as "failed".
 */
export const IMPORT_JOB_ATTEMPTS = 3;
export const DELIVERY_JOB_ATTEMPTS = 3;

/** Rows per staging INSERT transaction. */
export const STAGING_BATCH_SIZE = 500;
/** Customers per BulkInsertCustomers call. */
export const DELIVERY_BATCH_SIZE = 500;
/** Rows per keyset page read from import_staging. */
export const DELIVERY_PAGE_SIZE = 1_000;

/**
 * Delivery waits for staging by rescheduling itself. Staging that dies without
 * writing a terminal status would otherwise keep that loop alive forever, so it
 * stops at whichever limit is hit first and fails the import.
 */
export interface RescheduleLimits {
  maxReschedules: number;
  maxStagingWaitMs: number;
  baseDelayMs: number;
  jitterMs: number;
}

export const RESCHEDULE_LIMITS: RescheduleLimits = {
  maxReschedules: 120,
  maxStagingWaitMs: 20 * 60_000,
  baseDelayMs: 5_000,
  jitterMs: 3_000,
};
