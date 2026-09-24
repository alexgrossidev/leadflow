import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/** An automation rule: which contacts it targets (field/operator/value) and whether it runs. */
export const automations = mysqlTable(
  "automation_rules",
  {
    id: int("id").autoincrement().primaryKey(),
    user_id: int("user_id").notNull(),
    business_id: int("business_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    automationType: mysqlEnum("type", ["customer", "lead"]),
    paused: boolean("paused").notNull().default(false),
    field: varchar("field", { length: 255 }),
    operator: mysqlEnum("operator", ["eq", "neq", "contains", "gt", "lt", "is_set", "is_not_set"]),
    value: text("value"),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("idx_automation_business").on(t.business_id)],
);

export type Automation = typeof automations.$inferSelect;
export type NewAutomation = typeof automations.$inferInsert;
