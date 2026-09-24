import { index, mysqlTable, int, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/** Custom field definitions (the "attribute" side of the customer EAV model). */
export const customField = mysqlTable(
  "customers_v2_customfields",
  {
    id: int("id").notNull().primaryKey().autoincrement(),
    businessId: int("business_id").notNull(),
    userId: int("user_id").notNull(),
    field: varchar("field", { length: 255 }).notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    // Required by the ON DUPLICATE KEY upserts of field definitions.
    uniqueIndex("uq_cf_business_field").on(table.businessId, table.field),
    index("idx_cf_business_deleted").on(table.businessId, table.deletedAt),
  ],
);

export type CustomerField = typeof customField.$inferSelect;
export type NewCustomerField = typeof customField.$inferInsert;
