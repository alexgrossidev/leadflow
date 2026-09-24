import { z } from "zod";
import { JobNames, type QueueWorker } from "@leadflow/shared";
import type { CustomerServiceClient } from "@leadflow/rpc";
import {
  DELIVERY_JOB_ATTEMPTS,
  IMPORT_JOB_ATTEMPTS,
} from "#config/constants";
import { bulkInsertCustomers } from "#core/grpc";
import { logger } from "#core/logger";
import type { ObjectStore } from "#core/objectStore";
import { queue } from "#core/queue";
import { deliverImport } from "#dispatchers/deliverImport";
import { stageImport } from "#dispatchers/stageImport";
import type { ImportStatusStore, StagingStore } from "#dispatchers/pipeline/types";
import { createCustomerGRPCPayload } from "#dispatchers/utils/customer.createPayload";
import { withGrpcRetry } from "#dispatchers/utils/grpc.retry";
import { reportImportResult } from "#dispatchers/utils/reportResult";

export interface WorkerDeps {
  objects: ObjectStore;
  staging: StagingStore;
  status: ImportStatusStore;
  customerClient: CustomerServiceClient;
  grpcDeadlineMs: number;
  maxSpreadsheetBytes: number;
}

const importJobSchema = z.object({
  id: z.string().min(1),
  businessId: z.number().int().positive(),
  userId: z.number().int(),
  type: z.string(),
  filePath: z.string().min(1),
});

/** BullMQ counts failed attempts; this one is the last if it fails too. */
function isFinalAttempt(attemptsMade: number, maxAttempts: number): boolean {
  return attemptsMade + 1 >= maxAttempts;
}

function deliveryJobId(importJobId: string, suffix?: string): string {
  return suffix ? `${importJobId}:deliver:${suffix}` : `${importJobId}:deliver`;
}

export function startWorkers(deps: WorkerDeps): QueueWorker[] {
  const importWorker = queue.process(JobNames.HEAVY_PROCESSES_IMPORT, async (job) => {
    const parsed = importJobSchema.safeParse(job.data);
    if (!parsed.success) {
      // Deterministic: a retry would fail the same way. The payload may lack
      // the ids needed to report back, so it is only logged (without the data).
      logger.error(
        { jobId: job.id, issues: parsed.error.issues.map((i) => i.path.join(".")) },
        "Rejected malformed import job",
      );
      return;
    }
    const { id, businessId, type, filePath } = parsed.data;

    if (type !== "customer") {
      const reason = `Import type "${type}" is not supported; only "customer" imports are implemented`;
      logger.warn({ importJobId: id, businessId, type }, reason);
      await reportImportResult({ importJobId: id, businessId, status: "failed", error: reason });
      return;
    }

    const outcome = await stageImport(
      {
        objects: deps.objects,
        staging: deps.staging,
        status: deps.status,
        report: reportImportResult,
        maxSpreadsheetBytes: deps.maxSpreadsheetBytes,
        log: logger,
      },
      {
        importJobId: id,
        businessId,
        fileKey: filePath,
        isFinalAttempt: isFinalAttempt(job.attemptsMade, IMPORT_JOB_ATTEMPTS),
      },
    );
    if (outcome.kind !== "staged") return;

    await queue.enqueue(
      JobNames.HEAVY_PROCESSES_COMPLETE,
      {
        sessionId: id,
        userId: parsed.data.userId,
        businessId,
        type: "customer",
        customfieldSettings: job.data.customfieldSettings,
      },
      { jobId: deliveryJobId(id), attempts: DELIVERY_JOB_ATTEMPTS },
    );
  });

  const deliveryWorker = queue.process(JobNames.HEAVY_PROCESSES_COMPLETE, async (job) => {
    const payload = job.data;
    const context = { importJobId: payload.sessionId, businessId: payload.businessId };

    await deliverImport(
      {
        staging: deps.staging,
        status: deps.status,
        report: reportImportResult,
        log: logger,
        deliver: async (customers, batchIndex) => {
          const request = createCustomerGRPCPayload(
            payload.sessionId,
            payload.businessId,
            customers,
          );
          const response = await withGrpcRetry(
            () => bulkInsertCustomers(deps.customerClient, request, deps.grpcDeadlineMs),
            { ...context, batchIndex },
          );
          if (response.success === false) {
            throw new Error(`Gateway rejected batch ${batchIndex}: ${response.message ?? "no reason given"}`);
          }
        },
        reschedule: async (delayMs, attempt) => {
          await queue.enqueue(JobNames.HEAVY_PROCESSES_COMPLETE, payload, {
            delay: delayMs,
            jobId: deliveryJobId(payload.sessionId, `r${attempt}`),
            attempts: DELIVERY_JOB_ATTEMPTS,
          });
        },
      },
      {
        payload,
        isFinalAttempt: isFinalAttempt(job.attemptsMade, DELIVERY_JOB_ATTEMPTS),
      },
    );
  });

  return [importWorker, deliveryWorker];
}
