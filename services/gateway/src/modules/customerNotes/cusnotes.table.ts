import {
  datetime,
  foreignKey,
  index,
  int,
  mysqlTable,
  text,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";
import { customers } from "../customers/customers.table.js";

export const customerNotes = mysqlTable(
  "customer_notes_v2",
  {
    id: int("id").primaryKey().autoincrement(),
    customerId: int("customer_id").notNull(),
    businessId: int("business_id").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    createdBy: int("created_by").notNull(),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
    // Client-supplied, so a retried POST resolves to the note it already created.
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    deletedAt: datetime("deleted_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "fk_customer_notes_customer_id",
    }).onDelete("cascade"),
    unique("uq_notes_business_idempotency").on(table.businessId, table.idempotencyKey),
    index("idx_notes_customer_active").on(table.customerId, table.deletedAt),
  ],
);

export type CustomerNote = typeof customerNotes.$inferSelect;
export type NewNote = typeof customerNotes.$inferInsert;
