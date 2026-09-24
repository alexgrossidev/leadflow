import { sql } from "drizzle-orm";
import {
  mysqlTable,
  int,
  varchar,
  datetime,
  char,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable(
  "users",
  {
    id: int("id").primaryKey().autoincrement(),
    username: varchar("username", { length: 100 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }),
    company: varchar("company", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    createdAt: datetime("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    uniqueIndex("uq_users_username").on(t.username),
    uniqueIndex("uq_users_email").on(t.email),
  ],
);

export type User = typeof users.$inferSelect;

/**
 * One row per issued refresh token. Rotation marks the presented row revoked and
 * inserts its successor in the same `family_id`; presenting an already-revoked
 * token means it was stolen or replayed, so the whole family is revoked.
 */
export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: int("id").primaryKey().autoincrement(),
    userId: int("user_id").notNull(),
    familyId: char("family_id", { length: 36 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    expiresAt: datetime("expires_at").notNull(),
    revokedAt: datetime("revoked_at"),
    createdAt: datetime("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    uniqueIndex("uq_refresh_token_hash").on(t.tokenHash),
    index("idx_refresh_family").on(t.familyId),
    index("idx_refresh_user").on(t.userId),
  ],
);

export type RefreshTokenRecord = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
