import {
  mysqlTable,
  int,
  varchar,
  mysqlEnum,
  json,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * Per-lead delivery guard. The unique (user_id, lead_id) lets exactly one worker
 * claim a delivery; `status` records whether the gateway accepted it so a
 * redrive never re-sends a delivered lead.
 */
export const leadDelivery = mysqlTable(
  "lead_delivery",
  {
    id: int("id").primaryKey().autoincrement(),

    userId: int("user_id").notNull(),
    leadId: varchar("lead_id", { length: 64 }).notNull(),

    status: mysqlEnum("status", ["IN_FLIGHT", "DELIVERED"])
      .notNull()
      .default("IN_FLIGHT"),

    attempts: int("attempts").notNull().default(0),
    /** The gateway's `{ id, created }` reply, kept for traceability. */
    deliveryResponse: json("delivery_response").$type<unknown>(),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),

    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => [uniqueIndex("uq_lead_delivery").on(table.userId, table.leadId)],
);
