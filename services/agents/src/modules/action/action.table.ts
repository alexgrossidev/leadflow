import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import { ACTION_STATUSES, ACTION_TYPES } from "./action.registry.js";
import type { ActionPayload } from "./action.schema.js";

/**
 * One row per agent run, scoped by (businessId, userId). Ids are external
 * (gateway-owned) and stored as opaque varchars.
 *
 * Retention: `payload` holds the customer's messages only while the run needs
 * them. It is set to NULL in the same update that records a terminal status,
 * so a finished run keeps metadata (status, tools used, token usage, error
 * code) and no message content.
 */
export const agentActions = mysqlTable(
  "agent_actions",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    businessId: varchar("business_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    type: mysqlEnum("type", ACTION_TYPES).notNull(),
    status: mysqlEnum("status", ACTION_STATUSES).notNull().default("pending"),
    payload: json("payload").$type<ActionPayload>(),
    /** Metadata only, e.g. "actions: respond_whatsapp". Never message content. */
    summary: varchar("summary", { length: 255 }),
    errorCode: varchar("error_code", { length: 64 }),
    attempts: int("attempts").notNull().default(0),
    inputTokens: int("input_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("agent_actions_tenant_idx").on(table.businessId, table.userId, table.createdAt),
    index("agent_actions_status_idx").on(table.status),
  ],
);

export type AgentActionRecord = typeof agentActions.$inferSelect;
export type AgentActionInsert = typeof agentActions.$inferInsert;
