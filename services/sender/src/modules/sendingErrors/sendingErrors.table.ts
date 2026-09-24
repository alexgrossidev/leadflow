import { mysqlTable, int, varchar, timestamp, mysqlEnum, index } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/** Messages the pipeline refused or could not deliver, with the stage that stopped them. */
export const sendingErrors = mysqlTable(
  "sending_errors",
  {
    id: int("id").autoincrement().primaryKey(),
    automationId: int("automation_id").notNull(),
    recipientType: mysqlEnum("recipient_type", ["lead", "customer"]).notNull(),
    recipientId: int("recipient_id").notNull(),
    userId: int("user_id").notNull(),
    businessId: int("business_id").notNull(),
    channel: mysqlEnum("channel", ["email", "whatsapp"]).notNull(),
    stage: varchar("stage", { length: 32 }).notNull(),
    error: varchar("error", { length: 255 }).notNull(),
    warningLevel: varchar("warning_level", { length: 16 }),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_sending_errors_automation").on(table.automationId, table.recipientId)],
);

export type NewSendingError = typeof sendingErrors.$inferInsert;
