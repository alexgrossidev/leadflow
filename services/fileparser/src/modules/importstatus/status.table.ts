import {
  char,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { importStatus } from "#config/constants";

export const importStatusTable = mysqlTable("import_status", {
  importJobId: char("import_job_id", { length: 36 }).primaryKey(),
  status: mysqlEnum("status", [
    importStatus.PENDING,
    importStatus.INPROGRESS,
    importStatus.COMPLETE,
    importStatus.PROCESSED,
    importStatus.FAIL,
  ]).notNull(),
  /** How many times delivery was postponed while staging was still running. */
  rescheduleCount: int("reschedule_count").notNull().default(0),
  failReason: varchar("fail_reason", { length: 512 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type ImportStatusRow = typeof importStatusTable.$inferSelect;
