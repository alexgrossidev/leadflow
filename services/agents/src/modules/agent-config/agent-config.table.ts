import {
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import {
  ASSISTANT_TYPES,
  type AgentCapability,
} from "./agent-config.registry.js";

/**
 * One agent configuration per (businessId, userId) tenant pair.
 * Ids are external (gateway-owned), stored as opaque varchars.
 */
export const agentConfigs = mysqlTable(
  "agent_configs",
  {
    businessId: varchar("business_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 64 }).notNull(),
    instructions: text("instructions").notNull(),
    /** Null when the tenant has not named the assistant; it stays unnamed. */
    assistantName: varchar("assistant_name", { length: 64 }),
    assistantType: mysqlEnum("assistant_type", ASSISTANT_TYPES)
      .default("receptionist")
      .notNull(),
    capabilities: json("capabilities").$type<AgentCapability[]>().notNull(),
    knowledgeBase: mediumtext("knowledge_base"),
    /** Null reads as "none set". */
    forbiddenKeywords: json("forbidden_keywords").$type<string[]>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.businessId, table.userId] })],
);

export type AgentConfigRecord = typeof agentConfigs.$inferSelect;
export type AgentConfigInsert = typeof agentConfigs.$inferInsert;
