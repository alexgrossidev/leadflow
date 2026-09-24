import { mysqlTable, int, varchar, mysqlEnum, primaryKey } from "drizzle-orm/mysql-core";

/** Delivery addresses of enrolled contacts, shared by every automation of a business. */
export const contacts = mysqlTable(
  "contacts",
  {
    originalId: int("original_id").notNull(),
    type: mysqlEnum("type", ["lead", "customer"]).notNull(),
    businessId: int("business_id").notNull(),
    userId: int("user_id").notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 64 }),
  },
  (table) => [
    primaryKey({
      name: "pk_contacts",
      columns: [table.originalId, table.type, table.businessId],
    }),
  ],
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
