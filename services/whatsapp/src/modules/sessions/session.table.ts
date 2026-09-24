import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const SESSION_STATUSES = [
  "connecting",
  "qr_ready",
  "qr_scanned",
  "connected",
  "disconnected",
  "failed",
  "closed",
] as const;

export const whatsappSessions = mysqlTable(
  "whatsapp_sessions",
  {
    id: int("id").autoincrement().notNull().primaryKey(),
    businessId: int("business_id").notNull(),
    userId: int("user_id").notNull(),
    status: mysqlEnum("status", SESSION_STATUSES).notNull().default("connecting"),
    qrCode: text("qr_code"),
    qrExpiresAt: timestamp("qr_expires_at"),
    connectedAt: timestamp("connected_at"),
    disconnectedAt: timestamp("disconnected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("whatsapp_sessions_business_user_uq").on(table.businessId, table.userId),
    index("whatsapp_sessions_status_idx").on(table.status),
  ],
);

export type SessionRow = typeof whatsappSessions.$inferSelect;
export type NewSessionRow = typeof whatsappSessions.$inferInsert;
export type SessionStatus = SessionRow["status"];
