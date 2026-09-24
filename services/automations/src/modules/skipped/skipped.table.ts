import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  mysqlEnum,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

/**
 * Targets parked while their automation is paused. A row is a full snapshot of
 * the target so it can be restored exactly; `id` exists for keyset pagination.
 */
export const skips = mysqlTable(
  "skipped_actions",
  {
    id: int("id").autoincrement().primaryKey(),
    automationId: int("automation_id").notNull(),
    type: mysqlEnum("type", ["lead", "customer"]).notNull(),
    originalId: int("original_id").notNull(),
    userId: int("user_id").notNull(),
    businessId: int("business_id").notNull(),
    step: int("step"),
    stepId: int("step_id"),
    pausedTime: timestamp("paused_time"),
    enrolledAt: timestamp("enrolled_at").notNull(),
    lastExecutionTime: timestamp("last_execution_time"),
    expectedExecutionTime: timestamp("expected_execution_time"),
    reasonCode: varchar("reason_code", { length: 50 }).notNull(),
    skippedAt: timestamp("skipped_at").notNull(),
  },
  (table) => [
    uniqueIndex("uniq_skipped_target").on(table.automationId, table.type, table.originalId),
  ],
);

export type SkippedTarget = typeof skips.$inferSelect;
