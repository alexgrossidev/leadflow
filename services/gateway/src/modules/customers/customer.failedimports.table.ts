import {
  mysqlTable,
  int,
  varchar,
  text,
  timestamp,
  index,
} from "drizzle-orm/mysql-core";

/** Dead-letter rows from bulk imports, surfaced to the user in the import report. */
export const customersFailedImports = mysqlTable(
  "customers_v2_failed_imports",
  {
    id: int("id").primaryKey().autoincrement(),
    businessId: int("business_id").notNull(),
    userId: int("user_id").notNull(),
    importJobId: varchar("import_job_id", { length: 255 }).notNull(),
    importSourceKey: varchar("import_source_key", { length: 255 }).notNull(),
    customerName: varchar("customer_name", { length: 255 }),
    customerEmail: varchar("customer_email", { length: 255 }),
    customerPhone: varchar("customer_phone", { length: 100 }),
    fieldSlug: varchar("field_slug", { length: 255 }),
    fieldValue: text("field_value"),
    rowHash: varchar("row_hash", { length: 64 }),
    failureReason: varchar("failure_reason", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("idx_fail_job").on(table.importJobId),
    index("idx_fail_business").on(table.businessId),
  ],
);
