import {
  char,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/** One row per bulk import; the parser reports progress back onto it. */
export const csvLargeUpload = mysqlTable(
  "upload_session",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    businessId: int("business_id").notNull(),
    type: mysqlEnum("type", ["lead", "customer"]).notNull().default("customer"),
    storageKey: varchar("storage_key", { length: 255 }).notNull(),
    filename: varchar("filename", { length: 255 }),
    importJobId: char("import_job_id", { length: 36 }).notNull(),
    status: mysqlEnum("status", ["uploaded", "processing", "completed", "failed"]),
    totalRows: int("total_rows").default(0),
    processedRows: int("processed_rows").default(0),
    failedRows: int("failed_rows").default(0),
    started_at: timestamp("started_at").default(sql`CURRENT_TIMESTAMP`),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    completed_at: timestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("uq_upload_job").on(t.importJobId),
    index("idx_upload_business").on(t.businessId, t.type),
  ],
);

export type NewUploadSession = typeof csvLargeUpload.$inferInsert;
