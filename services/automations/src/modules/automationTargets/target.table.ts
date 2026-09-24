import {
  mysqlTable,
  int,
  timestamp,
  mysqlEnum,
  boolean,
  primaryKey,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * One row per (automation, contact) enrolment. `step`/`stepId` point at the
 * NEXT step to run; `lastExecutionTime` is when the previous step was handed
 * to the sender (the sender may still hold it back for limits/opening hours).
 */
export const targets = mysqlTable(
  "automation_targets",
  {
    automationId: int("automation_id").notNull(),
    type: mysqlEnum("type", ["lead", "customer"]).notNull(),
    originalId: int("original_id").notNull(),
    userId: int("user_id").notNull(),
    businessId: int("business_id").notNull(),
    step: int("step"),
    stepId: int("step_id"),
    paused: boolean("paused").notNull().default(false),
    pausedTime: timestamp("paused_time"),
    enrolledAt: timestamp("enrolled_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastExecutionTime: timestamp("last_execution_time"),
    expectedExecutionTime: timestamp("expected_execution_time"),
  },
  (table) => [
    primaryKey({
      name: "pk_automation_targets",
      columns: [table.automationId, table.type, table.originalId],
    }),
    index("idx_automation_targets_paused").on(table.automationId, table.paused),
  ],
);

export type Target = typeof targets.$inferSelect;
export type NewTarget = typeof targets.$inferInsert;
export type TargetKey = Pick<Target, "automationId" | "type" | "originalId">;
