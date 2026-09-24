import { mysqlTable, int, boolean, varchar } from "drizzle-orm/mysql-core";

export const settings = mysqlTable("settings", {
  businessId: int("business_id").primaryKey(),
  validateForBusinessHours: boolean("validate_for_business_hours").notNull(),
  inWarmUpMode: boolean("in_warm_up_mode").notNull(),
  maxEmails: int("max_emails").notNull(),
  maxWhatsapps: int("max_whatsapps").notNull(),
  /** Percentage of each cap held back as a safety margin. */
  toleranceRate: int("tolerance_rate").notNull(),
  /** Seconds; the floor of the gap between two messages from the same user. */
  minimumWaitBetweenMessages: int("minimum_wait_between_messages").notNull(),
  /** IANA zone that opening times and daily counters are evaluated in. */
  timezone: varchar("timezone", { length: 64 }).notNull().default("Europe/Rome"),
});

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
