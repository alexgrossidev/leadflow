import { logger as defaultLogger, type Logger } from "#core/logger";
import { queue } from "#core/queue";
import {
  isRecoverableQueue,
  leadJobId,
  leadJobOptions,
  recoveryKeyOf,
  type RecoverableQueue,
} from "#core/jobs";
import type { JobPayloadMap, TypedQueueClient } from "@leadflow/shared/jobs";
import { dbErrorCode } from "#database/errors";
import type { QueueRecoveryStore } from "./failed.repo";
import type { QueueRecoveryInput, SweepOptions } from "./failed.schema";

export interface RecoveryItemResult {
  recoveryId: number;
  outcome: "REQUEUED" | "FAILED_PERMANENTLY" | "SKIPPED";
}

export interface RecoverySweepResult {
  claimed: number;
  requeued: number;
  failedPermanently: number;
  skipped: number;
}

type EnqueueQueue = Pick<TypedQueueClient, "enqueue">;

/** Backoff doubles per attempt and is capped, so a stuck record cannot starve the sweep. */
const BASE_BACKOFF_MS = 60_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;
/** After this many re-drives a still-failing job is parked for manual triage. */
export const MAX_RECOVERY_RETRIES = 8;
/** A claim older than this means the sweeper died between claim and finalize. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

export function recoveryBackoffMs(retryCount: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, retryCount), MAX_BACKOFF_MS);
}

export class QueueRecoveryService {
  constructor(
    private readonly repo: QueueRecoveryStore,
    private readonly jobs: EnqueueQueue = queue,
    private readonly log: Logger = defaultLogger,
  ) {}

  /**
   * Persist a job that exhausted its in-queue retries. One row per natural key:
   * a lead that fails again after a re-drive re-opens its row with a higher
   * retry count, so the backoff keeps growing and the cap is eventually hit.
   * FATAL failures are parked for manual triage (no auto-retry).
   */
  async capture(input: QueueRecoveryInput, now = new Date()): Promise<void> {
    const dedupeKey = recoveryKeyOf(input.queueName, input.payload);
    // Read-then-upsert is not atomic, but the unique key keeps it to one row
    // and a lead is only processed by one job at a time (jobId dedupe).
    const existing = await this.repo.findByKey(input.queueName, dedupeKey);
    const retryCount = existing ? existing.retryCount + 1 : 0;
    const giveUp =
      input.errorType === "FATAL" || retryCount >= MAX_RECOVERY_RETRIES;

    await this.repo.upsert({
      queueName: input.queueName,
      dedupeKey,
      payload: input.payload,
      errorCode: input.errorCode ?? null,
      errorType: input.errorType,
      status: giveUp ? "FAILED_PERMANENTLY" : "PENDING_RECOVERY",
      retryCount,
      nextRetryAt: giveUp
        ? null
        : new Date(now.getTime() + recoveryBackoffMs(retryCount)),
    });

    this.log.warn(
      { queue: input.queueName, key: dedupeKey, retryCount, parked: giveUp },
      "Job dead-lettered to queue_recovery",
    );
  }

  /**
   * Re-drive due records onto their source queues: claim (status guard) →
   * enqueue → finalize, with no transaction spanning the enqueue. The job id is
   * derived from (key, retryCount), so if the process dies after the enqueue
   * but before finalize, the stale-claim reclaim re-enqueues the same id and
   * BullMQ deduplicates it. Safe to run concurrently on every replica.
   */
  async runSweep(options: SweepOptions = {}): Promise<RecoverySweepResult> {
    const now = options.now ?? new Date();
    const limit = options.limit ?? 50;
    const staleClaimBefore = new Date(now.getTime() - STALE_CLAIM_MS);
    const due = await this.repo.findDue(now, staleClaimBefore, limit);

    const result: RecoverySweepResult = {
      claimed: 0,
      requeued: 0,
      failedPermanently: 0,
      skipped: 0,
    };

    for (const record of due) {
      const item = await this.recoverOne(record, staleClaimBefore, now);
      if (item.outcome === "SKIPPED") result.skipped += 1;
      else result.claimed += 1;
      if (item.outcome === "REQUEUED") result.requeued += 1;
      if (item.outcome === "FAILED_PERMANENTLY") result.failedPermanently += 1;
    }

    if (due.length > 0) this.log.info(result, "Queue recovery sweep complete");
    return result;
  }

  private async recoverOne(
    record: {
      id: number;
      queueName: string;
      dedupeKey: string;
      retryCount: number;
      payload: unknown;
    },
    staleClaimBefore: Date,
    now: Date,
  ): Promise<RecoveryItemResult> {
    const recoveryId = record.id;
    const won = await this.repo.claimForRecovery(recoveryId, staleClaimBefore);
    if (!won) return { recoveryId, outcome: "SKIPPED" };

    if (!isRecoverableQueue(record.queueName)) {
      // Unknown queue (renamed or retired): nothing can consume it.
      await this.repo.finalize(recoveryId, "FAILED_PERMANENTLY");
      return { recoveryId, outcome: "FAILED_PERMANENTLY" };
    }

    const jobId = `${leadJobId(record.queueName, record.dedupeKey)}_recovery_${record.retryCount}`;
    try {
      await this.jobs.enqueue(
        record.queueName,
        record.payload as JobPayloadMap[RecoverableQueue],
        leadJobOptions(jobId),
      );
    } catch (err) {
      this.log.error(
        { recoveryId, queue: record.queueName, err },
        "Failed to re-enqueue recovery record; rescheduling",
      );
      await this.repo.reschedule(
        recoveryId,
        new Date(now.getTime() + recoveryBackoffMs(record.retryCount)),
      );
      return { recoveryId, outcome: "SKIPPED" };
    }

    try {
      // false means the re-driven job already failed again and re-opened the
      // row, which is exactly the state we want to leave alone.
      await this.repo.finalize(recoveryId, "RESOLVED");
    } catch (err) {
      // The job is enqueued; a stale-claim reclaim re-enqueues the same id,
      // which BullMQ ignores. Nothing is lost by leaving the row RECOVERING.
      this.log.error(
        { recoveryId, code: dbErrorCode(err) },
        "Re-enqueued recovery record but failed to finalize it",
      );
    }
    return { recoveryId, outcome: "REQUEUED" };
  }
}
