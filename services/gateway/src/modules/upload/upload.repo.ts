import { and, desc, eq, notInArray } from "drizzle-orm";
import { ImportResultReportPayload } from "@leadflow/shared/jobs";
import { mainDb } from "#database/mainPool";
import { NewUploadSession, csvLargeUpload } from "./upload.table.js";
import { UploadType } from "./upload.types.js";

const MAX_LISTED_SESSIONS = 50;

export class CsvLargeUploadRepository {
  async create(data: NewUploadSession): Promise<number> {
    const [result] = await mainDb.insert(csvLargeUpload).values(data);
    return result.insertId;
  }

  /**
   * Applies a parser-reported import outcome onto the session row. Only the
   * columns present on the event are written; terminal states stamp completed_at.
   */
  async applyResult(result: ImportResultReportPayload): Promise<void> {
    const isTerminal = result.status === "completed" || result.status === "failed";

    // BullMQ delivers at-least-once, so retried/out-of-order events are
    // expected. A late or duplicate non-terminal event ("processing") must
    // never overwrite a row that already reached a terminal state, otherwise a
    // finished import visibly flips back to "processing". Terminal events stay
    // unguarded so the outcome can always be stamped.
    const target = and(
      eq(csvLargeUpload.importJobId, result.importJobId),
      eq(csvLargeUpload.businessId, result.businessId),
    );
    const where = isTerminal
      ? target
      : and(target, notInArray(csvLargeUpload.status, ["completed", "failed"]));

    await mainDb
      .update(csvLargeUpload)
      .set({
        status: result.status,
        ...(result.totalRows != null ? { totalRows: result.totalRows } : {}),
        ...(result.processedRows != null ? { processedRows: result.processedRows } : {}),
        ...(result.failedRows != null ? { failedRows: result.failedRows } : {}),
        ...(isTerminal ? { completed_at: new Date() } : {}),
      })
      .where(where);
  }

  /** Single import session scoped to its owning business. */
  async findSessionByJobId(importJobId: string, businessId: number) {
    const [session] = await mainDb
      .select()
      .from(csvLargeUpload)
      .where(
        and(
          eq(csvLargeUpload.importJobId, importJobId),
          eq(csvLargeUpload.businessId, businessId),
        ),
      )
      .limit(1);
    return session ?? null;
  }

  /** Most recent import sessions of one type for a business. */
  async findLatestByBusiness(businessId: number, type: UploadType) {
    return mainDb
      .select()
      .from(csvLargeUpload)
      .where(and(eq(csvLargeUpload.businessId, businessId), eq(csvLargeUpload.type, type)))
      .orderBy(desc(csvLargeUpload.id))
      .limit(MAX_LISTED_SESSIONS);
  }
}
