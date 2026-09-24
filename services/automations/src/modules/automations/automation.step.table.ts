import {
  mysqlTable,
  int,
  varchar,
  text,
  timestamp,
  mysqlEnum,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const automationSteps = mysqlTable(
  "automation_rules_steps",
  {
    id: int("id").autoincrement().primaryKey(),
    automation_id: int("automation_id").notNull(),
    title: varchar("title", { length: 255 }),
    description: varchar("description", { length: 255 }),
    stepType: mysqlEnum("type", ["email", "whatsapp"]).notNull(),
    subject: varchar("email_subject", { length: 255 }),
    content: text("content"),
    attachments: text("attachments"),
    delay: int("delay").notNull().default(0),
    delay_unit: varchar("delay_unit", { length: 16 }).notNull().default("minute"),
    step_sequence: int("step_sequence").notNull(),
    created_at: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updated_at: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  // Steps are addressed by their position: the gateway owns step ids in its
  // own database, so (automation, sequence) is the stable key across services.
  (table) => [
    uniqueIndex("uniq_automation_step_sequence").on(table.automation_id, table.step_sequence),
  ],
);

export type AutomationStep = typeof automationSteps.$inferSelect;
