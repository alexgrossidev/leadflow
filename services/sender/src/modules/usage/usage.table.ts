import { mysqlTable, int, date, timestamp, primaryKey } from "drizzle-orm/mysql-core";

/**
 * Messages sent per user per local day. A new day is a new row, so counters
 * "reset" without a scheduled job: yesterday's row simply stops being read.
 */
export const dailyUsage = mysqlTable(
  "daily_usage",
  {
    userId: int("user_id").notNull(),
    /** Local calendar day (YYYY-MM-DD) in the business's timezone. */
    day: date("day", { mode: "string" }).notNull(),
    emailsSent: int("emails_sent").notNull().default(0),
    whatsappSent: int("whatsapp_sent").notNull().default(0),
    lastMessageSentAt: timestamp("last_message_sent_at"),
  },
  (table) => [primaryKey({ name: "pk_daily_usage", columns: [table.userId, table.day] })],
);

export type DailyUsage = Pick<typeof dailyUsage.$inferSelect, "emailsSent" | "whatsappSent">;
