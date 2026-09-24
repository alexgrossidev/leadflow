import { index, int, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { businesses } from "../business/business.table.js";
import { users } from "../auth/auth.table.js";

/** Append-only record of destructive or sensitive actions. */
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: int("id").autoincrement().primaryKey(),
    businessId: int("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: int("user_id")
      .notNull()
      .references(() => users.id),
    action: varchar("action", { length: 100 }).notNull(),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  },
  (t) => [
    index("idx_audit_business_created").on(t.businessId, t.createdAt),
    index("idx_audit_user").on(t.userId),
  ],
);

export type NewAuditLog = typeof auditLogs.$inferInsert;
