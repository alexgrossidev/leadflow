import {
  mysqlTable,
  int,
  varchar,
  char,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * One connected Facebook account per (user, business). The row doubles as the
 * persisted progress of the token-exchange state machine: `token_type` moves
 * from "user" to "page", then `valid`, `fb_page_id` and `subscribed` fill in.
 */
export const facebookToken = mysqlTable(
  "facebook_token",
  {
    id: int("id").primaryKey().autoincrement(),

    userId: int("user_id").notNull(),
    businessId: int("business_id").notNull(),
    fbPageId: varchar("fb_page_id", { length: 32 }),

    /** The page token once exchanged; the user token while the exchange is mid-flight. */
    token: text("token").notNull(),
    tokenType: varchar("token_type", { length: 50 }).notNull(),

    subscribed: boolean("subscribed").notNull(),
    valid: boolean("valid").notNull().default(false),
    expiresAt: timestamp("expires_at").notNull(),

    /** Long-lived user token retained so the refresh flow can re-mint page tokens. */
    refreshToken: text("refresh_token"),

    /**
     * SHA-256 of the OAuth code this row was exchanged from. A retry of the same
     * job sees a matching hash and resumes instead of replaying the single-use
     * code; a new connection arrives with a different hash and re-exchanges.
     */
    oauthCodeHash: char("oauth_code_hash", { length: 64 }),

    lastSyncedAt: timestamp("last_synced_at"),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),

    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uq_facebook_token_user_business").on(
      table.userId,
      table.businessId,
    ),
    index("idx_fb_page_id").on(table.fbPageId),
  ],
);

export type FacebookTokenUserData = typeof facebookToken.$inferInsert;
export type FacebookToken = typeof facebookToken.$inferSelect;
