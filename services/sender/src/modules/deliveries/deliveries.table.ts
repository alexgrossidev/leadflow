import { mysqlTable, int, varchar, timestamp, mysqlEnum, index } from "drizzle-orm/mysql-core";

/** Ledger of messages handed to a channel, keyed by the pipeline's message key. */
export const sentMessages = mysqlTable(
  "sent_messages",
  {
    messageKey: varchar("message_key", { length: 191 }).primaryKey(),
    automationId: int("automation_id").notNull(),
    recipientType: mysqlEnum("recipient_type", ["lead", "customer"]).notNull(),
    recipientId: int("recipient_id").notNull(),
    userId: int("user_id").notNull(),
    businessId: int("business_id").notNull(),
    channel: mysqlEnum("channel", ["email", "whatsapp"]).notNull(),
    sentAt: timestamp("sent_at").notNull(),
  },
  (table) => [index("idx_sent_messages_automation").on(table.automationId)],
);

/** A ledger row plus the local day whose counter it increments. */
export type DeliveryRecord = typeof sentMessages.$inferInsert & { day: string };
