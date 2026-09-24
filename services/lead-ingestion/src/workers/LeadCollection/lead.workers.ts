import { queue } from "#core/queue";
import { LEAD_JOB_ATTEMPTS, type RecoverableQueue } from "#core/jobs";
import { JobNames } from "@leadflow/shared/jobs";
import type { QueueWorker } from "@leadflow/shared/queue";
import { LEAD_CAPTURE_PROCESS } from "#dispatchers/lead.PROCESS";
import { GOOGLE_LEAD_CAPTURE_PROCESS } from "#dispatchers/googleLead.PROCESS";
import { LeadFatalError } from "../../modules_inbound/fbLead/fbLead.errors";
import { queueRecoveryClient } from "../../modules_inbound/failed/failed.module";
import { runWithTerminalHandling, type TerminalPolicy } from "../terminal";

/**
 * A lead that fails fatally or exhausts its retries is dead-lettered to
 * queue_recovery instead of vanishing into BullMQ's failed set. FATAL is parked
 * for triage; an exhausted TRANSIENT is armed for the recovery sweep.
 */
function deadLetterPolicy<T>(queueName: RecoverableQueue): TerminalPolicy<T> {
  return {
    maxAttempts: LEAD_JOB_ATTEMPTS,
    isFatal: (err) => err instanceof LeadFatalError,
    onTerminal: (payload, err, fatal) =>
      queueRecoveryClient.capture({
        queueName,
        payload,
        errorCode: err instanceof Error ? err.name : null,
        errorType: fatal ? "FATAL" : "TRANSIENT",
      }),
  };
}

export function startFacebookLeadWorker(): QueueWorker {
  const policy = deadLetterPolicy(JobNames.FACEBOOK_LEAD_PROCESS);
  return queue.process(JobNames.FACEBOOK_LEAD_PROCESS, (job) =>
    runWithTerminalHandling(job, policy, () => LEAD_CAPTURE_PROCESS(job.data)),
  );
}

export function startGoogleLeadWorker(): QueueWorker {
  const policy = deadLetterPolicy(JobNames.GOOGLE_LEAD_PROCESS);
  return queue.process(JobNames.GOOGLE_LEAD_PROCESS, (job) =>
    runWithTerminalHandling(job, policy, () =>
      GOOGLE_LEAD_CAPTURE_PROCESS(job.data),
    ),
  );
}
