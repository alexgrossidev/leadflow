import {
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";
import { customers } from "../customers/customers.table.js";

export const customerDocuments = mysqlTable(
  "customer_documents_v2",
  {
    id: int("id").primaryKey().autoincrement(),
    businessId: int("business_id").notNull(),
    customerId: int("customer_id").notNull(),
    fileName: varchar("file_name", { length: 255 }).notNull(),
    // Object storage key, always inside CUSTOMER_DOCUMENT/<user>/<business>/.
    filePath: varchar("file_path", { length: 1024 }).notNull(),
    fileType: varchar("file_type", { length: 255 }).notNull(),
    fileSizeInBytes: int("file_size_in_bytes").notNull(),
    note: text("note"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    // RESTRICT: a customer with documents cannot be hard-deleted by accident.
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "fk_customer_documents_customer_id",
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    unique("uq_docs_business_idempotency").on(table.businessId, table.idempotencyKey),
    index("idx_docs_business_customer").on(table.businessId, table.customerId, table.deletedAt),
  ],
);

export type CustomerDocument = typeof customerDocuments.$inferSelect;
export type NewCustomerDocument = typeof customerDocuments.$inferInsert;
