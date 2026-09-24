import type { OnboardingResult } from "#dispatchers/onboarding/types";
import type { ActionResult, ActionStore } from "../action/action.repository.js";
import type { ActionStatus } from "../action/action.registry.js";
import type { ActionListQuery } from "../action/action.schema.js";
import type { AgentActionInsert, AgentActionRecord } from "../action/action.table.js";
import type { AgentConfigStore } from "../agent-config/agent-config.repository.js";
import type { AgentConfigInsert, AgentConfigRecord } from "../agent-config/agent-config.table.js";
import type { BeginOutcome, IdempotencyStore } from "../onboarding/onboarding.repository.js";
import type { OnboardingRequestRecord } from "../onboarding/onboarding.table.js";

/** In-memory doubles with the same semantics as the Drizzle stores (atomic claim, purge on finish). */
export class InMemoryActionStore implements ActionStore {
  readonly rows = new Map<string, AgentActionRecord>();

  async insert(record: AgentActionInsert): Promise<AgentActionRecord> {
    const now = new Date();
    const row: AgentActionRecord = {
      status: "pending",
      payload: null,
      summary: null,
      errorCode: null,
      attempts: 0,
      inputTokens: 0,
      outputTokens: 0,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
      ...record,
    } as AgentActionRecord;
    this.rows.set(row.id, row);
    return { ...row };
  }

  async findById(id: string) {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async listByTenant(businessId: string, userId: string, query: ActionListQuery) {
    return [...this.rows.values()]
      .filter((row) => row.businessId === businessId && row.userId === userId)
      .filter((row) => !query.status || row.status === query.status)
      .slice(query.offset, query.offset + query.limit);
  }

  async claim(id: string) {
    const row = this.rows.get(id);
    if (!row || row.status !== "pending") return false;
    row.status = "running";
    row.startedAt = new Date();
    return true;
  }

  async finish(id: string, result: ActionResult) {
    const row = this.rows.get(id);
    if (!row) return;
    Object.assign(row, result, { payload: null, finishedAt: new Date() });
  }

  async deleteById(id: string) {
    return this.rows.delete(id);
  }

  async listIdsByStatus(status: ActionStatus, limit: number) {
    return [...this.rows.values()]
      .filter((row) => row.status === status)
      .slice(0, limit)
      .map((row) => row.id);
  }
}

export class InMemoryAgentConfigStore implements AgentConfigStore {
  readonly rows = new Map<string, AgentConfigRecord>();

  async upsert(record: AgentConfigInsert): Promise<AgentConfigRecord> {
    const now = new Date();
    const row = {
      assistantName: null,
      assistantType: "receptionist",
      knowledgeBase: null,
      forbiddenKeywords: [],
      createdAt: now,
      updatedAt: now,
      ...record,
    } as AgentConfigRecord;
    this.rows.set(`${row.businessId}/${row.userId}`, row);
    return row;
  }

  async findByTenant(businessId: string, userId: string) {
    return this.rows.get(`${businessId}/${userId}`) ?? null;
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly rows = new Map<string, OnboardingRequestRecord>();

  async begin(userId: string, key: string, requestHash: string): Promise<BeginOutcome> {
    const existing = this.rows.get(`${userId}/${key}`);
    if (existing) return { started: false, existing: { ...existing } };
    const now = new Date();
    this.rows.set(`${userId}/${key}`, {
      userId,
      idempotencyKey: key,
      requestHash,
      status: "in_progress",
      result: null,
      createdAt: now,
      updatedAt: now,
    });
    return { started: true };
  }

  async complete(userId: string, key: string, result: OnboardingResult) {
    Object.assign(this.rows.get(`${userId}/${key}`)!, { status: "completed", result });
  }

  async fail(userId: string, key: string) {
    Object.assign(this.rows.get(`${userId}/${key}`)!, { status: "failed" });
  }
}
