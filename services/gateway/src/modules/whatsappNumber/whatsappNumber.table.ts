import { int, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const whatsappNumbers = mysqlTable(
  "whatsapp_numbers",
  {
    id: int("id").autoincrement().primaryKey(),
    businessId: int("business_id").notNull(),
    userId: int("user_id").notNull(),
    phoneNumber: varchar("phone_number", { length: 30 }).notNull(),
    sessionId: varchar("session_id", { length: 255 }),
    createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [uniqueIndex("uq_whatsapp_business_phone").on(table.businessId, table.phoneNumber)],
);

export type NewWhatsappNumber = typeof whatsappNumbers.$inferInsert;
