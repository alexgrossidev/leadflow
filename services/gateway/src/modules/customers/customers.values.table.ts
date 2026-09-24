import { index, int, mysqlTable, text, unique } from "drizzle-orm/mysql-core";
import { customers } from "./customers.table.js";
import { customField } from "./customers.fields.table.js";

/** Custom field values (the "value" side of the customer EAV model). */
export const customFieldValue = mysqlTable(
  "customers_v2_customvalues",
  {
    id: int("id").notNull().primaryKey().autoincrement(),
    businessId: int("business_id").notNull(),
    userId: int("user_id").notNull(),
    customerId: int("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    customFieldId: int("customfield_id")
      .notNull()
      .references(() => customField.id, { onDelete: "cascade" }),
    customFieldValue: text("customfield_value"),
  },
  (table) => [
    index("idx_cv_business").on(table.businessId),
    unique("uq_cust_field").on(table.customerId, table.customFieldId),
  ],
);
