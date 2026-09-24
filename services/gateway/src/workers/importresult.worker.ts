import { JobNames } from "@leadflow/shared/jobs";
import type { QueueWorker } from "@leadflow/shared/queue";
import { queue } from "#comms/bullmq/bullmq.queue";
import { uploadService } from "../modules/upload/upload.module.js";
import { logger } from "#core/logger";

/**
 * Consumes import-result events emitted by the parser and surfaces the outcome
 * on the gateway-owned upload_session row, so the user can see the result of
 * their import (status + row counts).
 */
export function startImportResultWorker(): QueueWorker {
  return queue.process(JobNames.HEAVY_PROCESSES_RESULT, async (job) => {
    const result = job.data;
    if (!result.importJobId || !result.status) {
      throw new Error(`Malformed import result event (job ${job.id})`);
    }

    await uploadService.applyResults(result);

    logger.info(
      {
        importJobId: result.importJobId,
        businessId: result.businessId,
        status: result.status,
        totalRows: result.totalRows,
        processedRows: result.processedRows,
        failedRows: result.failedRows,
      },
      "Import result applied to upload session",
    );
  });
}
