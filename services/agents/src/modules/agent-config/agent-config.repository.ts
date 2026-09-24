import { and, eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { InternalServerError } from "#core/errors/http-errors";
import {
  agentConfigs,
  type AgentConfigInsert,
  type AgentConfigRecord,
} from "./agent-config.table.js";

/** Persistence port for tenant configs. */
export interface AgentConfigStore {
  upsert(record: AgentConfigInsert): Promise<AgentConfigRecord>;
  findByTenant(businessId: string, userId: string): Promise<AgentConfigRecord | null>;
}

export class DrizzleAgentConfigStore implements AgentConfigStore {
  constructor(private readonly database: MySql2Database) {}

  /**
   * Atomic create-or-replace of a tenant's config. Insert-or-update and the
   * readback run in one transaction so the returned row is exactly what was
   * persisted by this call.
   */
  async upsert(record: AgentConfigInsert): Promise<AgentConfigRecord> {
    return this.database.transaction(async (tx) => {
      await tx
        .insert(agentConfigs)
        .values(record)
        .onDuplicateKeyUpdate({
          set: {
            instructions: record.instructions,
            assistantName: record.assistantName ?? null,
            assistantType: record.assistantType,
            capabilities: record.capabilities,
            knowledgeBase: record.knowledgeBase ?? null,
            forbiddenKeywords: record.forbiddenKeywords ?? [],
          },
        });

      const [row] = await tx
        .select()
        .from(agentConfigs)
        .where(
          and(
            eq(agentConfigs.businessId, record.businessId),
            eq(agentConfigs.userId, record.userId),
          ),
        )
        .limit(1);

      if (!row) {
        throw new InternalServerError("Agent config readback failed after upsert");
      }
      return row;
    });
  }

  async findByTenant(businessId: string, userId: string): Promise<AgentConfigRecord | null> {
    const [row] = await this.database
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.businessId, businessId), eq(agentConfigs.userId, userId)))
      .limit(1);
    return row ?? null;
  }
}
