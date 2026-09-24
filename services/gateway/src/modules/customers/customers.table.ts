import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const customers = mysqlTable(
  "customers_v2",
  {
    id: int("id").primaryKey().autoincrement(),

    businessId: int("business_id").notNull(),
    userId: int("user_id").notNull(),

    name: varchar("name", { length: 255 }),
    // NULL when unknown: the unique key below ignores NULLs, so several
    // email-less customers can coexist while real emails stay unique.
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 100 }),

    created: timestamp("created").defaultNow().notNull(),
    updated: timestamp("updated").defaultNow().onUpdateNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (t) => [
    // CRM identity: one customer per email within a business.
    uniqueIndex("uq_business_email").on(t.businessId, t.email),
    index("idx_business_active").on(t.businessId, t.deletedAt, t.id),
  ],
);

export type Customer = typeof customers.$inferSelect;
