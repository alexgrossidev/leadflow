import {
  JobNames,
  type FacebookLeadProcessPayload,
  type GoogleLeadProcessPayload,
} from "@leadflow/shared/jobs";
import type { EnqueueOptions } from "@leadflow/shared/queue";

/**
 * Retry policy for lead-capture jobs. Every producer (webhook, reconciliation
 * sync, recovery sweep) enqueues through {@link leadJobOptions}, and the
 * workers read {@link LEAD_JOB_ATTEMPTS} to detect the final attempt, so the
 * two can never disagree.
 */
export const LEAD_JOB_ATTEMPTS = 5;

export function leadJobOptions(jobId: string): EnqueueOptions {
  return {
    jobId,
    attempts: LEAD_JOB_ATTEMPTS,
    backoff: { type: "exponential", delay: 5000 },
    // Keep completed ids for a day so a replayed webhook dedupes against them.
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
  };
}

/** Queues whose exhausted jobs are dead-lettered to queue_recovery and re-driven. */
export type RecoverableQueue =
  | typeof JobNames.FACEBOOK_LEAD_PROCESS
  | typeof JobNames.GOOGLE_LEAD_PROCESS;

/** The natural key a recoverable job is deduplicated on. */
export function recoveryKeyOf(queueName: RecoverableQueue, payload: unknown): string {
  if (queueName === JobNames.FACEBOOK_LEAD_PROCESS) {
    return (payload as FacebookLeadProcessPayload).leadgenId;
  }
  return (payload as GoogleLeadProcessPayload).responseId;
}

/** Primary job id of a lead job; recovery and redrive ids derive from it. */
export function leadJobId(queueName: RecoverableQueue, key: string): string {
  return queueName === JobNames.FACEBOOK_LEAD_PROCESS
    ? `lead_${key}`
    : `glead_${key}`;
}

export const isRecoverableQueue = (name: string): name is RecoverableQueue =>
  name === JobNames.FACEBOOK_LEAD_PROCESS ||
  name === JobNames.GOOGLE_LEAD_PROCESS;
