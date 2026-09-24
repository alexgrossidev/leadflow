import {
  mysqlTable,
  varchar,
  json,
  mysqlEnum,
  int,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * Dead-letter store for jobs that exhausted their in-queue retries. One row per
 * (queue, natural key): a lead that fails again after being re-driven re-opens
 * its row and bumps `retry_count`, so backoff keeps growing instead of resetting.
 */
export const queueRecovery = mysqlTable(
  "queue_recovery",
  {
    id: int("id").primaryKey().autoincrement(),

    queueName: varchar("queue_name", { length: 128 }).notNull(),
    /** Natural key of the job (leadgenId / responseId). */
    dedupeKey: varchar("dedupe_key", { length: 128 }).notNull(),

    payload: json("payload").notNull(),

    errorCode: varchar("error_code", { length: 50 }),

    errorType: mysqlEnum("error_type", ["TRANSIENT", "FATAL"]).notNull(),

    status: mysqlEnum("status", [
      "PENDING_RECOVERY",
      "RECOVERING",
      "FAILED_PERMANENTLY",
      "RESOLVED",
    ])
      .notNull()
      .default("PENDING_RECOVERY"),

    retryCount: int("retry_count").notNull().default(0),

    nextRetryAt: timestamp("next_retry_at"),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),

    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uq_queue_recovery_key").on(table.queueName, table.dedupeKey),
    index("idx_status_retry").on(table.status, table.nextRetryAt),
  ],
);

export type QueueRecoveryInsert = typeof queueRecovery.$inferInsert;
export type QueueRecoveryRecord = typeof queueRecovery.$inferSelect;
