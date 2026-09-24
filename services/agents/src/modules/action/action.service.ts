import { randomUUID } from "node:crypto";
import { NotFoundError, ServiceUnavailableError } from "#core/errors/http-errors";
import type { ActionStore } from "./action.repository.js";
import type {
  ActionCreateInput,
  ActionListQuery,
  ActionTenantParams,
} from "./action.schema.js";
import type { AgentActionRecord } from "./action.table.js";

/** What the API exposes about a run: everything except the customer payload. */
export type ActionView = Omit<AgentActionRecord, "payload">;

const toView = ({ payload: _payload, ...view }: AgentActionRecord): ActionView => view;

/** Where accepted runs go. Implemented by WorkQueue. */
export interface RunQueue {
  readonly isFull: boolean;
  enqueue(id: string): boolean;
}

export class ActionService {
  constructor(
    private readonly store: ActionStore,
    private readonly queue: RunQueue,
  ) {}

  /**
   * Accepts a trigger: persist it as pending, hand it to the background queue,
   * return immediately. The run's progress is read back through `get`.
   */
  async record(input: ActionCreateInput): Promise<ActionView> {
    // Checked before the insert, so a refused trigger leaves no orphan row.
    if (this.queue.isFull) {
      throw new ServiceUnavailableError(
        "Agent queue is full; retry later",
        "AGENT_QUEUE_FULL",
      );
    }
    const action = await this.store.insert({
      id: randomUUID(),
      businessId: input.businessId,
      userId: input.userId,
      type: input.type,
      status: "pending",
      payload: input.payload,
    });
    // If the queue filled up in between, the row stays pending and the next
    // boot's recovery picks it up; the caller still gets its id.
    this.queue.enqueue(action.id);
    return toView(action);
  }

  async get(id: string): Promise<ActionView> {
    const action = await this.store.findById(id);
    if (!action) throw new NotFoundError(`No agent action with id ${id}`);
    return toView(action);
  }

  /** A tenant with no actions is a legitimate empty list, not a 404. */
  async list(tenant: ActionTenantParams, query: ActionListQuery): Promise<ActionView[]> {
    const rows = await this.store.listByTenant(tenant.businessId, tenant.userId, query);
    return rows.map(toView);
  }

  async remove(id: string): Promise<void> {
    if (!(await this.store.deleteById(id))) {
      throw new NotFoundError(`No agent action with id ${id}`);
    }
  }
}
