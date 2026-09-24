import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/** One message in an automation's sequence (email or WhatsApp, after a delay). */
export const automationSteps = mysqlTable(
  "automation_rules_steps",
  {
    id: int("id").autoincrement().primaryKey(),
    automation_id: int("automation_id").notNull(),
    title: varchar("title", { length: 255 }),
    description: varchar("description", { length: 255 }),
    stepType: mysqlEnum("type", ["email", "whatsapp"]),
    subject: varchar("email_subject", { length: 255 }),
    content: text("content"),
    attachments: text("attachments"),
    delay: int("delay"),
    delay_unit: varchar("delay_unit", { length: 255 }),
    step_sequence: int("step_sequence"),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (t) => [index("idx_steps_automation").on(t.automation_id)],
);

export type AutomationStep = typeof automationSteps.$inferSelect;
export type NewAutomationStep = typeof automationSteps.$inferInsert;
