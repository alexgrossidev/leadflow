import { and, desc, eq } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import { InternalServerError } from "#core/errors/http-errors";
import type { ActionStatus } from "./action.registry.js";
import type { ActionListQuery } from "./action.schema.js";
import {
  agentActions,
  type AgentActionInsert,
  type AgentActionRecord,
} from "./action.table.js";

export interface ActionResult {
  status: Extract<ActionStatus, "succeeded" | "failed">;
  summary: string;
  errorCode: string | null;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
}

/** Persistence port for agent runs; the service and executor depend on this, not on Drizzle. */
export interface ActionStore {
  insert(record: AgentActionInsert): Promise<AgentActionRecord>;
  findById(id: string): Promise<AgentActionRecord | null>;
  listByTenant(
    businessId: string,
    userId: string,
    query: ActionListQuery,
  ): Promise<AgentActionRecord[]>;
  /**
   * Atomically moves a pending run to running. False when another worker (or
   * an earlier boot) already took it, so a run is never executed twice.
   */
  claim(id: string): Promise<boolean>;
  /** Records a terminal status and purges the customer payload in the same write. */
  finish(id: string, result: ActionResult): Promise<void>;
  deleteById(id: string): Promise<boolean>;
  listIdsByStatus(status: ActionStatus, limit: number): Promise<string[]>;
}

export class DrizzleActionStore implements ActionStore {
  constructor(private readonly database: MySql2Database) {}

  /** Insert and readback in one transaction, so the row returned is exactly the one written. */
  async insert(record: AgentActionInsert): Promise<AgentActionRecord> {
    return this.database.transaction(async (tx) => {
      await tx.insert(agentActions).values(record);
      const [row] = await tx
        .select()
        .from(agentActions)
        .where(eq(agentActions.id, record.id))
        .limit(1);
      if (!row) {
        throw new InternalServerError("Agent action readback failed after insert");
      }
      return row;
    });
  }

  async findById(id: string): Promise<AgentActionRecord | null> {
    const [row] = await this.database
      .select()
      .from(agentActions)
      .where(eq(agentActions.id, id))
      .limit(1);
    return row ?? null;
  }

  /** Newest first, paginated: a busy tenant's history is unbounded. */
  async listByTenant(
    businessId: string,
    userId: string,
    query: ActionListQuery,
  ): Promise<AgentActionRecord[]> {
    const filters = [
      eq(agentActions.businessId, businessId),
      eq(agentActions.userId, userId),
    ];
    if (query.status) filters.push(eq(agentActions.status, query.status));
    if (query.type) filters.push(eq(agentActions.type, query.type));

    return this.database
      .select()
      .from(agentActions)
      .where(and(...filters))
      .orderBy(desc(agentActions.createdAt))
      .limit(query.limit)
      .offset(query.offset);
  }

  async claim(id: string): Promise<boolean> {
    const [result] = await this.database
      .update(agentActions)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(agentActions.id, id), eq(agentActions.status, "pending")));
    return result.affectedRows === 1;
  }

  async finish(id: string, result: ActionResult): Promise<void> {
    await this.database
      .update(agentActions)
      .set({
        status: result.status,
        summary: result.summary.slice(0, 255),
        errorCode: result.errorCode,
        attempts: result.attempts,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        payload: null,
        finishedAt: new Date(),
      })
      .where(eq(agentActions.id, id));
  }

  async deleteById(id: string): Promise<boolean> {
    const [result] = await this.database
      .delete(agentActions)
      .where(eq(agentActions.id, id));
    return result.affectedRows > 0;
  }

  async listIdsByStatus(status: ActionStatus, limit: number): Promise<string[]> {
    const rows = await this.database
      .select({ id: agentActions.id })
      .from(agentActions)
      .where(eq(agentActions.status, status))
      .orderBy(agentActions.createdAt)
      .limit(limit);
    return rows.map((row) => row.id);
  }
}
