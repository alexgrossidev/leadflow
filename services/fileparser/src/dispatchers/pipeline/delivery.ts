import type { CompleteImportWithSettingsPayload } from "@leadflow/shared/jobs";
import {
  mapRowToCustomer,
  prepareColumnSettings,
  type MappedCustomer,
} from "../utils/fieldMapping.js";
import { batched } from "./batch.js";
import type { StagedRow, StagingStore } from "./types.js";

/**
 * Yields every undelivered staged row of a job in id order, one page at a
 * time. Keyset pagination (id > last seen) keeps each page an index range scan,
 * where OFFSET would rescan all earlier rows and make the full read O(n^2). It
 * is also safe while rows are being marked DELIVERED behind the cursor.
 */
export async function* undeliveredRows(
  store: StagingStore,
  importJobId: string,
  pageSize: number,
): AsyncGenerator<StagedRow> {
  let afterId = 0;
  for (;;) {
    const page = await store.readUndeliveredPage(importJobId, afterId, pageSize);
    const last = page.at(-1);
    if (!last) return;
    for (const row of page) yield row;
    afterId = last.id;
  }
}

/** mysql2 returns JSON columns parsed; a string means it was stored as text. */
export function decodeRawData(raw: unknown, rowId: number): Record<string, unknown> {
  const value: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Staged row ${rowId} does not hold a JSON object`);
  }
  return value as Record<string, unknown>;
}

export type DeliverBatch = (
  customers: MappedCustomer[],
  batchIndex: number,
) => Promise<void>;

export interface DeliverStagedRowsOptions {
  importJobId: string;
  store: StagingStore;
  settings: CompleteImportWithSettingsPayload["customfieldSettings"];
  deliver: DeliverBatch;
  batchSize: number;
  pageSize: number;
}

/**
 * Maps undelivered staged rows to customers and hands them to `deliver` in
 * batches, marking each batch DELIVERED only after `deliver` resolves. If the
 * process dies or a batch fails, a rerun picks up exactly the rows that were
 * not acknowledged. The window between a successful call and the status update
 * makes delivery at-least-once; the gateway dedupes on the customer hash.
 */
export async function deliverStagedRows({
  importJobId,
  store,
  settings,
  deliver,
  batchSize,
  pageSize,
}: DeliverStagedRowsOptions): Promise<{ delivered: number; batches: number }> {
  const prepared = prepareColumnSettings(settings);
  let delivered = 0;
  let batches = 0;

  for await (const batch of batched(
    undeliveredRows(store, importJobId, pageSize),
    batchSize,
  )) {
    const customers = batch.map((row) =>
      mapRowToCustomer(decodeRawData(row.rawData, row.id), prepared),
    );
    await deliver(customers, batches);
    await store.markDelivered(
      importJobId,
      batch.map((row) => row.id),
    );
    delivered += batch.length;
    batches += 1;
  }

  return { delivered, batches };
}
