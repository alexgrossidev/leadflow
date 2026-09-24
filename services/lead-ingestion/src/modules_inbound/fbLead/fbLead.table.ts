import {
  mysqlTable,
  int,
  varchar,
  boolean,
  json,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/**
 * Persisted progress of one Facebook lead through FETCH → PARSE → DELIVER, so a
 * retried job resumes from the last completed stage.
 */
export const facebookLead = mysqlTable(
  "facebook_lead",
  {
    id: int("id").primaryKey().autoincrement(),

    userId: int("user_id").notNull(),

    leadId: varchar("lead_id", { length: 64 }).notNull(),

    fetched: boolean("fetched").notNull().default(false),
    delivered: boolean("delivered").notNull().default(false),

    rawResponse: json("raw_response").notNull(),
    cleanResponse: json("clean_response").notNull(),

    createdAt: timestamp("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),

    updatedAt: timestamp("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`)
      .onUpdateNow(),
  },
  (table) => [
    uniqueIndex("uq_user_lead").on(table.userId, table.leadId),
    index("idx_user_delivered").on(table.userId, table.delivered),
  ],
);

export type FacebookLeadData = typeof facebookLead.$inferInsert;
export type FacebookLead = typeof facebookLead.$inferSelect;
