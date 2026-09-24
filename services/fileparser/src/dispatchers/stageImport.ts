import type { Logger } from "pino";
import { importStatus, STAGING_BATCH_SIZE } from "#config/constants";
import type { ObjectStore } from "#core/objectStore";
import { detectFileKind, parseFile } from "./parsers/index.js";
import { FileTooLargeError, PermanentImportError } from "./pipeline/errors.js";
import { stageRows } from "./pipeline/staging.js";
import type {
  ImportStatusStore,
  ReportResult,
  StagingStore,
} from "./pipeline/types.js";

export interface StageImportDeps {
  objects: ObjectStore;
  staging: StagingStore;
  status: ImportStatusStore;
  report: ReportResult;
  maxSpreadsheetBytes: number;
  log: Logger;
  batchSize?: number;
}

export interface StageImportInput {
  importJobId: string;
  businessId: number;
  fileKey: string;
  /** The queue will not retry after this attempt. */
  isFinalAttempt: boolean;
}

export type StageImportOutcome =
  | { kind: "staged"; rows: number }
  | { kind: "rejected"; reason: string };

/**
 * Stage 1 of an import: download the file, parse it and write every row to
 * `import_staging`. Transient failures are rethrown so the queue retries (the
 * inserts are idempotent); permanent ones are recorded and reported once.
 */
export async function stageImport(
  deps: StageImportDeps,
  { importJobId, businessId, fileKey, isFinalAttempt }: StageImportInput,
): Promise<StageImportOutcome> {
  const { objects, staging, status, report, maxSpreadsheetBytes } = deps;
  const log = deps.log.child({ importJobId, businessId, stage: "staging" });

  await status.set(importJobId, importStatus.INPROGRESS);

  try {
    const kind = detectFileKind(fileKey);

    if (kind === "spreadsheet") {
      // Checked before downloading anything, because spreadsheets are parsed
      // in memory (see parsers/xlsx.ts).
      const size = await objects.sizeOf(fileKey);
      if (size !== undefined && size > maxSpreadsheetBytes) {
        throw new FileTooLargeError(size, maxSpreadsheetBytes);
      }
    }

    log.info({ kind }, "Staging started");
    const source = await objects.open(fileKey);

    let rows = 0;
    await parseFile(
      kind,
      source,
      async (records) => {
        rows = await stageRows(records, {
          importJobId,
          businessId,
          store: staging,
          batchSize: deps.batchSize ?? STAGING_BATCH_SIZE,
        });
      },
      maxSpreadsheetBytes,
    );

    if (rows === 0) {
      throw new PermanentImportError("File contains a header but no data rows");
    }

    await status.set(importJobId, importStatus.COMPLETE);
    log.info({ rows }, "Staging finished");
    return { kind: "staged", rows };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const permanent = error instanceof PermanentImportError;

    if (permanent || isFinalAttempt) {
      log.error({ err: error, permanent }, "Staging failed");
      await status.set(importJobId, importStatus.FAIL, reason);
      await report({ importJobId, businessId, status: "failed", error: reason });
    } else {
      log.warn({ err: error }, "Staging attempt failed; the queue will retry");
    }

    if (permanent) return { kind: "rejected", reason };
    throw error;
  }
}
