import type { Logger } from "pino";
import type { CompleteImportWithSettingsPayload } from "@leadflow/shared/jobs";
import {
  DELIVERY_BATCH_SIZE,
  DELIVERY_PAGE_SIZE,
  importStatus,
  RESCHEDULE_LIMITS,
  type RescheduleLimits,
} from "#config/constants";
import { deliverStagedRows, type DeliverBatch } from "./pipeline/delivery.js";
import type {
  ImportStatusStore,
  ReportResult,
  StagingStore,
} from "./pipeline/types.js";

export interface DeliverImportDeps {
  staging: StagingStore;
  status: ImportStatusStore;
  report: ReportResult;
  deliver: DeliverBatch;
  /** Enqueue this same delivery job again after `delayMs`. */
  reschedule: (delayMs: number, attempt: number) => Promise<void>;
  log: Logger;
  limits?: RescheduleLimits;
  now?: () => number;
  random?: () => number;
  batchSize?: number;
  pageSize?: number;
}

export interface DeliverImportInput {
  payload: CompleteImportWithSettingsPayload;
  isFinalAttempt: boolean;
}

export type DeliverImportOutcome =
  | { kind: "delivered"; totalRows: number; deliveredRows: number }
  | { kind: "rescheduled"; delayMs: number }
  | { kind: "staging-timeout"; reason: string }
  | { kind: "skipped"; status: string };

/**
 * Stage 2 of an import: send the staged rows to the gateway. Runs only once
 * staging is COMPLETE; while staging is still in progress it reschedules
 * itself, up to the limits in RESCHEDULE_LIMITS.
 */
export async function deliverImport(
  deps: DeliverImportDeps,
  { payload, isFinalAttempt }: DeliverImportInput,
): Promise<DeliverImportOutcome> {
  const { staging, status, report } = deps;
  const { sessionId: importJobId, businessId } = payload;
  const limits = deps.limits ?? RESCHEDULE_LIMITS;
  const now = deps.now ?? Date.now;
  const log = deps.log.child({ importJobId, businessId, stage: "delivery" });

  const current = await status.get(importJobId);
  if (!current) {
    throw new Error(`No import_status row for import ${importJobId}`);
  }

  switch (current.status) {
    case importStatus.PENDING:
    case importStatus.INPROGRESS: {
      const waitedMs = now() - current.createdAt.getTime();
      if (
        current.rescheduleCount >= limits.maxReschedules ||
        waitedMs >= limits.maxStagingWaitMs
      ) {
        const reason =
          `Staging did not finish: still "${current.status}" after ` +
          `${current.rescheduleCount} checks over ${Math.round(waitedMs / 1000)}s`;
        log.error({ rescheduleCount: current.rescheduleCount, waitedMs }, reason);
        await status.set(importJobId, importStatus.FAIL, reason);
        await report({ importJobId, businessId, status: "failed", error: reason });
        return { kind: "staging-timeout", reason };
      }

      const delayMs =
        limits.baseDelayMs +
        Math.floor((deps.random ?? Math.random)() * limits.jitterMs);
      const attempt = current.rescheduleCount + 1;
      await status.incrementReschedule(importJobId);
      await deps.reschedule(delayMs, attempt);
      log.info(
        { currentStatus: current.status, delayMs },
        "Staging not finished; delivery rescheduled",
      );
      return { kind: "rescheduled", delayMs };
    }
    case importStatus.FAIL:
    case importStatus.PROCESSED:
      // FAIL was already reported by the stage that set it; PROCESSED means a
      // duplicate job arrived after a successful delivery.
      log.info({ currentStatus: current.status }, "Nothing to deliver");
      return { kind: "skipped", status: current.status };
    case importStatus.COMPLETE:
      break;
  }

  const [pendingRows, previouslyDelivered] = await Promise.all([
    staging.countUndelivered(importJobId),
    staging.countDelivered(importJobId),
  ]);
  const totalRows = pendingRows + previouslyDelivered;

  await report({ importJobId, businessId, status: "processing", totalRows });

  try {
    const { delivered, batches } = await deliverStagedRows({
      importJobId,
      store: staging,
      settings: payload.customfieldSettings,
      deliver: deps.deliver,
      batchSize: deps.batchSize ?? DELIVERY_BATCH_SIZE,
      pageSize: deps.pageSize ?? DELIVERY_PAGE_SIZE,
    });
    const deliveredRows = previouslyDelivered + delivered;

    await status.set(importJobId, importStatus.PROCESSED);
    await report({
      importJobId,
      businessId,
      status: "completed",
      totalRows,
      processedRows: deliveredRows,
      failedRows: totalRows - deliveredRows,
    });
    log.info({ totalRows, deliveredRows, batches }, "Delivery finished");
    return { kind: "delivered", totalRows, deliveredRows };
  } catch (error) {
    if (isFinalAttempt) {
      const deliveredRows = await staging.countDelivered(importJobId);
      const reason = error instanceof Error ? error.message : String(error);
      log.error({ err: error, totalRows, deliveredRows }, "Delivery failed");
      await status.set(importJobId, importStatus.FAIL, reason);
      await report({
        importJobId,
        businessId,
        status: "failed",
        totalRows,
        processedRows: deliveredRows,
        failedRows: totalRows - deliveredRows,
        error: reason,
      });
    } else {
      // Status stays COMPLETE, so the retry resumes from undelivered rows.
      log.warn({ err: error }, "Delivery attempt failed; the queue will retry");
    }
    throw error;
  }
}
