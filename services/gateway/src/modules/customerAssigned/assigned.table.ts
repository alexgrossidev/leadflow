import {
  foreignKey,
  index,
  int,
  mysqlTable,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { customers } from "../customers/customers.table.js";

/** Which of the business's services a customer is subscribed to. */
export const assignedServices = mysqlTable(
  "customer_assigned_services_v2",
  {
    id: int("id").notNull().primaryKey().autoincrement(),
    businessId: int("business_id").notNull(),
    customerId: int("customer_id").notNull(),
    serviceId: int("customer_services_id").notNull(),
    createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.customerId],
      foreignColumns: [customers.id],
      name: "fk_assigned_services_customer_id",
    }).onDelete("cascade"),
    uniqueIndex("uq_assigned_business_customer_service").on(
      table.businessId,
      table.customerId,
      table.serviceId,
    ),
  ],
);
