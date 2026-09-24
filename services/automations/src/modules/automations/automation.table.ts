import {
  mysqlTable,
  int,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  boolean,
  index,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * Local copy of the gateway's automation rules, kept in sync by the
 * automation.* events. `paused`/`paused_at` are the single source of truth
 * for the pause state inside this service.
 */
export const automations = mysqlTable(
  "automation_rules",
  {
    id: int("id").primaryKey(),
    user_id: int("user_id").notNull(),
    business_id: int("business_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    automationType: mysqlEnum("type", ["customer", "lead"]).notNull().default("lead"),
    paused: boolean("paused").notNull().default(false),
    pausedAt: timestamp("paused_at"),
    /** Rule: which lead attribute to test. Null matches every lead. */
    field: varchar("field", { length: 255 }),
    operator: varchar("operator", { length: 32 }),
    value: text("value"),
    scheduledDeletionAt: timestamp("scheduled_deletion_at"),
    created_at: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_automation_rules_business").on(table.business_id, table.paused)],
);

export type AutomationRow = typeof automations.$inferSelect;
