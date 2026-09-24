import type { ImportResultReportPayload } from "@leadflow/shared/jobs";
import type { ImportStatusValue } from "#config/constants";

/** A cell after normalisation: always JSON-safe, so it round-trips through MySQL JSON. */
export type CellValue = string | number | boolean | null;

/** One parsed file row, keyed by column header, in the file's column order. */
export type RawRecord = Record<string, CellValue>;

export interface StagingRecord {
  rawData: RawRecord;
  dataHash: Buffer;
}

export interface StagedRow {
  id: number;
  /** As returned by the driver; decoded and validated by the delivery stage. */
  rawData: unknown;
}

/** Persistence port for `import_staging`; a fake implements it in tests. */
export interface StagingStore {
  /** Idempotent on (importJobId, dataHash); existing rows keep their status. */
  insertRaw(
    importJobId: string,
    businessId: number,
    records: StagingRecord[],
  ): Promise<void>;
  /** Undelivered rows with id > afterId, ascending by id (keyset pagination). */
  readUndeliveredPage(
    importJobId: string,
    afterId: number,
    limit: number,
  ): Promise<StagedRow[]>;
  markDelivered(importJobId: string, ids: number[]): Promise<void>;
  countUndelivered(importJobId: string): Promise<number>;
  countDelivered(importJobId: string): Promise<number>;
}

export interface ImportStatusSnapshot {
  status: ImportStatusValue;
  rescheduleCount: number;
  createdAt: Date;
}

/** Persistence port for `import_status`. */
export interface ImportStatusStore {
  set(
    importJobId: string,
    status: ImportStatusValue,
    failReason?: string,
  ): Promise<void>;
  get(importJobId: string): Promise<ImportStatusSnapshot | null>;
  incrementReschedule(importJobId: string): Promise<void>;
}

export type ReportResult = (payload: ImportResultReportPayload) => Promise<void>;
