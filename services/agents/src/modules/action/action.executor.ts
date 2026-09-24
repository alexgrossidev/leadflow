import { AGENT_ERROR_CODES, AgentError } from "#core/agent/agent.errors";
import type { AgentOutcome } from "#core/agent/loop";
import { withRetry, type RetryOptions } from "#core/agent/retry";
import { logger } from "#core/logger";
import type { AgentConfigRecord } from "#modules/agent-config/agent-config.table";
import type { AgentConfigStore } from "#modules/agent-config/agent-config.repository";
import type { ActionStore } from "./action.repository.js";
import type { AgentActionRecord } from "./action.table.js";

/** Runs the agent for one action; DISPATCH_AGENT_ACTION with its dependencies bound. */
export type ActionDispatch = (
  action: AgentActionRecord,
  config: AgentConfigRecord,
  signal: AbortSignal,
) => Promise<AgentOutcome>;

export interface ActionExecutorOptions {
  runTimeoutMs: number;
  retry: Pick<RetryOptions, "attempts" | "baseDelayMs" | "maxDelayMs" | "sleep" | "random">;
}

/**
 * Executes one queued run: claim it, run the agent under a deadline with the
 * retry policy, record the terminal status. `execute` never throws; every
 * outcome ends up on the row.
 */
export class ActionExecutor {
  constructor(
    private readonly actions: ActionStore,
    private readonly configs: Pick<AgentConfigStore, "findByTenant">,
    private readonly dispatch: ActionDispatch,
    private readonly options: ActionExecutorOptions,
  ) {}

  async execute(id: string): Promise<void> {
    try {
      if (!(await this.actions.claim(id))) return;
      const action = await this.actions.findById(id);
      if (!action) return;
      await this.run(action);
    } catch (error) {
      // Only persistence can fail here (run() records its own failures). The
      // row stays pending/running and boot recovery settles it.
      logger.error({ err: error, actionId: id }, "Could not execute agent action");
    }
  }

  /**
   * Settles runs a previous process left behind. A `running` row may already
   * have messaged the customer, and nothing records how far it got, so it is
   * failed, never replayed. A `pending` row never started and is safe to hand
   * back to the queue.
   */
  async recover(enqueue: (id: string) => boolean, limit = 1_000): Promise<void> {
    for (const id of await this.actions.listIdsByStatus("running", limit)) {
      await this.actions.finish(id, {
        status: "failed",
        summary: "Interrupted by a service restart; not retried because a reply may already have been sent",
        errorCode: AGENT_ERROR_CODES.interrupted,
        attempts: 0,
        inputTokens: 0,
        outputTokens: 0,
      });
    }
    const pending = await this.actions.listIdsByStatus("pending", limit);
    for (const id of pending) enqueue(id);
    if (pending.length > 0) {
      logger.info({ count: pending.length }, "Re-queued pending agent actions");
    }
  }

  private async run(action: AgentActionRecord): Promise<void> {
    const signal = AbortSignal.timeout(this.options.runTimeoutMs);
    let attempts = 0;
    try {
      const config = await this.configs.findByTenant(action.businessId, action.userId);
      if (!config) {
        throw new AgentError(
          `No agent config for business ${action.businessId}`,
          AGENT_ERROR_CODES.configMissing,
        );
      }

      const { value: outcome } = await withRetry(
        (attempt) => {
          attempts = attempt;
          return this.dispatch(action, config, signal);
        },
        {
          ...this.options.retry,
          signal,
          onRetry: (error, attempt, delayMs) =>
            logger.warn(
              { actionId: action.id, attempt, delayMs, code: error.code },
              "Transient provider failure, retrying agent run",
            ),
        },
      );

      await this.actions.finish(action.id, {
        status: "succeeded",
        summary: outcome.summary,
        errorCode: null,
        attempts,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
      });
      logger.info(
        { actionId: action.id, attempts, iterations: outcome.iterations, usage: outcome.usage },
        "Agent action succeeded",
      );
    } catch (error) {
      const failure =
        error instanceof AgentError
          ? error
          : new AgentError("Unexpected failure", AGENT_ERROR_CODES.toolFailed, { cause: error });
      await this.actions.finish(action.id, {
        status: "failed",
        // Engine messages carry codes, limits and ids, never customer content.
        summary: failure.message,
        errorCode: failure.code,
        attempts,
        inputTokens: failure.usage.inputTokens,
        outputTokens: failure.usage.outputTokens,
      });
      logger.warn(
        { actionId: action.id, attempts, code: failure.code, mutated: failure.mutated, err: failure.cause },
        "Agent action failed",
      );
    }
  }
}
