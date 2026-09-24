import {
  mysqlTable,
  int,
  varchar,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * Dead-letter for accounts whose Facebook token could not be refreshed or
 * auto-healed. One open row per (user, business); `notified_at` records that
 * the reconnect prompt was emitted, `resolved_at` that they reconnected. Kept as
 * an audit trail rather than deleted so we can prove a user was warned.
 */
export const facebookTokenFailure = mysqlTable(
  "facebook_token_failure",
  {
    id: int("id").primaryKey().autoincrement(),

    userId: int("user_id").notNull(),
    businessId: int("business_id").notNull(),
    pageId: varchar("page_id", { length: 32 }),

    reason: varchar("reason", { length: 128 }).notNull(),
    attempts: int("attempts").notNull().default(1),
    lastError: text("last_error"),

    notifiedAt: timestamp("notified_at"),
    resolvedAt: timestamp("resolved_at"),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),

    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => ({
    uniqUserBusiness: uniqueIndex("uq_token_failure_user_business").on(
      table.userId,
      table.businessId,
    ),
  }),
);

export type FacebookTokenFailure = typeof facebookTokenFailure.$inferSelect;
