import { eq, sql } from "drizzle-orm";
import { getDb } from "#core/db";
import type { ImportStatusValue } from "#config/constants";
import type {
  ImportStatusSnapshot,
  ImportStatusStore,
} from "#dispatchers/pipeline/types";
import { importStatusTable } from "./status.table.js";

const FAIL_REASON_MAX = 512;

export class ImportStatusRepository implements ImportStatusStore {
  async set(
    importJobId: string,
    status: ImportStatusValue,
    failReason?: string,
  ): Promise<void> {
    const reason = failReason?.slice(0, FAIL_REASON_MAX) ?? null;
    await getDb()
      .insert(importStatusTable)
      .values({ importJobId, status, failReason: reason })
      .onDuplicateKeyUpdate({ set: { status, failReason: reason } });
  }

  async get(importJobId: string): Promise<ImportStatusSnapshot | null> {
    const [row] = await getDb()
      .select({
        status: importStatusTable.status,
        rescheduleCount: importStatusTable.rescheduleCount,
        createdAt: importStatusTable.createdAt,
      })
      .from(importStatusTable)
      .where(eq(importStatusTable.importJobId, importJobId))
      .limit(1);
    return row ?? null;
  }

  async incrementReschedule(importJobId: string): Promise<void> {
    await getDb()
      .update(importStatusTable)
      .set({ rescheduleCount: sql`${importStatusTable.rescheduleCount} + 1` })
      .where(eq(importStatusTable.importJobId, importJobId));
  }
}
