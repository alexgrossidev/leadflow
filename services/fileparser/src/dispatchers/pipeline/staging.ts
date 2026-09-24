import { dedupHash } from "../utils/hash.js";
import { batched } from "./batch.js";
import type { RawRecord, StagingStore } from "./types.js";

export interface StageRowsOptions {
  importJobId: string;
  businessId: number;
  store: StagingStore;
  batchSize: number;
}

/**
 * Writes parsed rows to the staging table one batch at a time and returns how
 * many rows were read. Each insert is awaited before the next batch is pulled,
 * so a slow database slows the parser down instead of letting rows pile up.
 */
export async function stageRows(
  rows: AsyncIterable<RawRecord> | Iterable<RawRecord>,
  { importJobId, businessId, store, batchSize }: StageRowsOptions,
): Promise<number> {
  let staged = 0;
  for await (const batch of batched(rows, batchSize)) {
    await store.insertRaw(
      importJobId,
      businessId,
      batch.map((rawData) => ({ rawData, dataHash: dedupHash(rawData) })),
    );
    staged += batch.length;
  }
  return staged;
}
