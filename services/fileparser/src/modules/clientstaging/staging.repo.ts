import { and, asc, count, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "#core/db";
import { stagingRowStatus } from "#config/constants";
import type {
  StagedRow,
  StagingRecord,
  StagingStore,
} from "#dispatchers/pipeline/types";
import { clientImportStaging } from "./staging.table.js";

/** Rows per INSERT statement, well under MySQL's default max_allowed_packet. */
const INSERT_CHUNK_SIZE = 250;

export class ImportStagingRepository implements StagingStore {
  async insertRaw(
    importJobId: string,
    businessId: number,
    records: StagingRecord[],
  ): Promise<void> {
    if (records.length === 0) return;

    await getDb().transaction(async (tx) => {
      for (let i = 0; i < records.length; i += INSERT_CHUNK_SIZE) {
        const chunk = records.slice(i, i + INSERT_CHUNK_SIZE).map((r) => ({
          importJobId,
          businessId,
          rawData: r.rawData,
          dataHash: r.dataHash,
        }));
        // A duplicate (same job, same row hash) is left untouched. That makes a
        // staging retry idempotent and, crucially, never flips an already
        // DELIVERED row back to RAW.
        await tx
          .insert(clientImportStaging)
          .values(chunk)
          .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      }
    });
  }

  async readUndeliveredPage(
    importJobId: string,
    afterId: number,
    limit: number,
  ): Promise<StagedRow[]> {
    return getDb()
      .select({ id: clientImportStaging.id, rawData: clientImportStaging.rawData })
      .from(clientImportStaging)
      .where(
        and(
          eq(clientImportStaging.importJobId, importJobId),
          eq(clientImportStaging.status, stagingRowStatus.RAW),
          gt(clientImportStaging.id, afterId),
        ),
      )
      .orderBy(asc(clientImportStaging.id))
      .limit(limit);
  }

  async markDelivered(importJobId: string, ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await getDb()
      .update(clientImportStaging)
      .set({ status: stagingRowStatus.DELIVERED, deliveredAt: new Date() })
      .where(
        and(
          eq(clientImportStaging.importJobId, importJobId),
          inArray(clientImportStaging.id, ids),
        ),
      );
  }

  async countUndelivered(importJobId: string): Promise<number> {
    return this.countByStatus(importJobId, stagingRowStatus.RAW);
  }

  async countDelivered(importJobId: string): Promise<number> {
    return this.countByStatus(importJobId, stagingRowStatus.DELIVERED);
  }

  private async countByStatus(
    importJobId: string,
    status: (typeof stagingRowStatus)[keyof typeof stagingRowStatus],
  ): Promise<number> {
    const [row] = await getDb()
      .select({ n: count() })
      .from(clientImportStaging)
      .where(
        and(
          eq(clientImportStaging.importJobId, importJobId),
          eq(clientImportStaging.status, status),
        ),
      );
    return row?.n ?? 0;
  }
}
