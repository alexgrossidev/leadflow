import type { RecoverableQueue } from "#core/jobs";

export type RecoveryErrorType = "TRANSIENT" | "FATAL";

export type RecoveryStatus =
  | "PENDING_RECOVERY"
  | "RECOVERING"
  | "FAILED_PERMANENTLY"
  | "RESOLVED";

/**
 * What a worker hands over when a job has exhausted its in-queue retries.
 * `payload` is the original job payload, persisted verbatim so the record can
 * be replayed onto its source queue without lossy reconstruction.
 */
export interface QueueRecoveryInput {
  queueName: RecoverableQueue;
  payload: unknown;
  errorCode?: string | null;
  errorType: RecoveryErrorType;
}

export interface SweepOptions {
  limit?: number;
  now?: Date;
}
