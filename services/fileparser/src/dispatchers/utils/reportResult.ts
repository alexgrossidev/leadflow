import { JobNames, type ImportResultReportPayload } from "@leadflow/shared/jobs";
import { queue } from "#core/queue";
import { logger } from "#core/logger";

/**
 * Emits the import-result event the gateway consumes to update its
 * upload_session row. Reporting is best-effort: a failure to enqueue must not
 * mask or override the real pipeline result, so it is logged and swallowed.
 */
export async function reportImportResult(
  payload: ImportResultReportPayload,
): Promise<void> {
  try {
    await queue.enqueue(JobNames.HEAVY_PROCESSES_RESULT, payload);
  } catch (error) {
    logger.error(
      { err: error, importJobId: payload.importJobId, status: payload.status },
      "Failed to enqueue import-result event",
    );
  }
}
