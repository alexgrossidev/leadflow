import { and, asc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "#database/pool";
import { dbOp } from "#database/errors";
import {
  QueueRecoveryInsert,
  QueueRecoveryRecord,
  queueRecovery,
} from "./failed.table";
import type { RecoveryStatus } from "./failed.schema";

/** Persistence surface the recovery service depends on (injectable for tests). */
export interface QueueRecoveryStore {
  findByKey(queueName: string, dedupeKey: string): Promise<QueueRecoveryRecord | null>;
  upsert(data: QueueRecoveryInsert): Promise<void>;
  findDue(now: Date, staleClaimBefore: Date, limit: number): Promise<QueueRecoveryRecord[]>;
  claimForRecovery(id: number, staleClaimBefore: Date): Promise<boolean>;
  reschedule(id: number, nextRetryAt: Date): Promise<boolean>;
  finalize(
    id: number,
    status: Extract<RecoveryStatus, "RESOLVED" | "FAILED_PERMANENTLY">,
  ): Promise<boolean>;
}

/** A RECOVERING row whose claim is older than this is treated as a crashed sweep. */
const claimIsStale = (staleClaimBefore: Date) =>
  and(
    eq(queueRecovery.status, "RECOVERING"),
    lte(queueRecovery.updatedAt, staleClaimBefore),
  );

export class QueueRecoveryRepository implements QueueRecoveryStore {
  async findByKey(
    queueName: string,
    dedupeKey: string,
  ): Promise<QueueRecoveryRecord | null> {
    const [row] = await dbOp("queue_recovery.findByKey", () =>
      db
        .select()
        .from(queueRecovery)
        .where(
          and(
            eq(queueRecovery.queueName, queueName),
            eq(queueRecovery.dedupeKey, dedupeKey),
          ),
        )
        .limit(1),
    );
    return row ?? null;
  }

  /** One row per (queue, key): a repeat failure re-opens and overwrites it. */
  async upsert(data: QueueRecoveryInsert): Promise<void> {
    await dbOp("queue_recovery.upsert", () =>
      db
        .insert(queueRecovery)
        .values(data)
        .onDuplicateKeyUpdate({
          set: {
            payload: data.payload,
            errorCode: data.errorCode ?? null,
            errorType: data.errorType,
            status: data.status,
            retryCount: data.retryCount,
            nextRetryAt: data.nextRetryAt ?? null,
          },
        }),
    );
  }

  /**
   * Records due for a re-drive: pending ones whose backoff has elapsed, plus
   * RECOVERING ones whose claim went stale (the sweeper crashed between claim
   * and finalize). Bounded and ordered by id so a sweep pages deterministically.
   */
  async findDue(
    now: Date,
    staleClaimBefore: Date,
    limit: number,
  ): Promise<QueueRecoveryRecord[]> {
    return dbOp("queue_recovery.findDue", () =>
      db
        .select()
        .from(queueRecovery)
        .where(
          or(
            and(
              eq(queueRecovery.status, "PENDING_RECOVERY"),
              or(
                isNull(queueRecovery.nextRetryAt),
                lte(queueRecovery.nextRetryAt, now),
              ),
            ),
            claimIsStale(staleClaimBefore),
          ),
        )
        .orderBy(asc(queueRecovery.id))
        .limit(limit),
    );
  }

  /**
   * Atomically move a row to RECOVERING. The status predicate is the
   * concurrency guard: only one sweeper wins the conditional update. Stamping
   * `updated_at` restarts the stale-claim clock for the winner.
   */
  async claimForRecovery(id: number, staleClaimBefore: Date): Promise<boolean> {
    const [result] = await dbOp("queue_recovery.claim", () =>
      db
        .update(queueRecovery)
        .set({ status: "RECOVERING", updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(
          and(
            eq(queueRecovery.id, id),
            or(
              eq(queueRecovery.status, "PENDING_RECOVERY"),
              claimIsStale(staleClaimBefore),
            ),
          ),
        ),
    );
    return result.affectedRows === 1;
  }

  /**
   * Park a claimed row back to PENDING_RECOVERY, bumping the retry counter and
   * arming the next backoff window. Guarded on RECOVERING so it cannot clobber a
   * row another path already moved on.
   */
  async reschedule(id: number, nextRetryAt: Date): Promise<boolean> {
    const [result] = await dbOp("queue_recovery.reschedule", () =>
      db
        .update(queueRecovery)
        .set({
          status: "PENDING_RECOVERY",
          nextRetryAt,
          retryCount: sql`${queueRecovery.retryCount} + 1`,
        })
        .where(
          and(eq(queueRecovery.id, id), eq(queueRecovery.status, "RECOVERING")),
        ),
    );
    return result.affectedRows === 1;
  }

  /** Terminal transition for a claimed row. */
  async finalize(
    id: number,
    status: Extract<RecoveryStatus, "RESOLVED" | "FAILED_PERMANENTLY">,
  ): Promise<boolean> {
    const [result] = await dbOp("queue_recovery.finalize", () =>
      db
        .update(queueRecovery)
        .set({ status })
        .where(
          and(eq(queueRecovery.id, id), eq(queueRecovery.status, "RECOVERING")),
        ),
    );
    return result.affectedRows === 1;
  }
}
