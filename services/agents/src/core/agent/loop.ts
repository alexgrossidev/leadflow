import { logger } from "#core/logger";
import { AGENT_ERROR_CODES, AgentError, ToolRejection } from "./agent.errors.js";
import type {
  LlmProvider,
  TokenUsage,
  ToolCall,
  ToolOutcome,
  TranscriptEntry,
} from "./llm.port.js";
import { describeIssues, toToolSpec, type AgentTool } from "./tool.js";

export interface AgentRunInput {
  system: string;
  transcript: TranscriptEntry[];
  /** The decision space: the model can only pick from these. */
  tools: readonly AgentTool[];
  /** Aborts the run when its wall-clock budget is spent. */
  signal?: AbortSignal;
  /** Correlates log lines with the triggering action. */
  traceId?: string;
}

export interface AgentOutcome {
  /** Metadata only (which tools ran), never customer content: this is persisted. */
  summary: string;
  usage: TokenUsage;
  iterations: number;
  /** Names of tools that succeeded, in call order. */
  actions: string[];
  /** True when a side-effecting tool succeeded. */
  mutated: boolean;
}

export interface AgentLoopOptions {
  maxIterations: number;
  /** Per-response output cap passed to the provider. */
  maxTokens: number;
  /** Input + output tokens the whole run may spend. Omit for no budget. */
  maxRunTokens?: number;
}

/** Mutable bookkeeping for one run, read by the failure path. */
interface RunState {
  usage: Required<TokenUsage>;
  actions: string[];
  mutated: boolean;
  callCounts: Map<string, number>;
}

/**
 * Provider-agnostic agent loop: ask the model, perform the tools it picks, hand
 * the results back, repeat until it stops or a limit trips.
 *
 * Tool input is validated against the tool's schema before `execute` runs;
 * strict tool use guarantees that on Anthropic, but not every provider offers
 * it and a guarantee made elsewhere is not one this loop relies on. A call that
 * fails validation, names an unknown tool, exceeds its per-run cap, or throws
 * ToolRejection goes back to the model as an error result and the run
 * continues within its iteration and token budgets. Anything else a tool
 * throws is a real delivery failure and fails the run: a reply that never
 * reached the customer must never be recorded as completed.
 *
 * Every failure carries `mutated` (did a side-effecting tool already succeed?)
 * and the usage spent so far, so the caller can decide on a retry and still
 * bill the attempt.
 */
export class AgentLoop {
  constructor(
    private readonly provider: LlmProvider,
    private readonly options: AgentLoopOptions,
  ) {}

  async run(input: AgentRunInput): Promise<AgentOutcome> {
    const state: RunState = {
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      actions: [],
      mutated: false,
      callCounts: new Map(),
    };
    try {
      return await this.drive(input, state);
    } catch (error) {
      throw this.asFailure(error, state, input.signal);
    }
  }

  private async drive(input: AgentRunInput, state: RunState): Promise<AgentOutcome> {
    const transcript = [...input.transcript];
    const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
    const specs = input.tools.map(toToolSpec);

    for (let iteration = 1; iteration <= this.options.maxIterations; iteration++) {
      this.assertTimeLeft(input.signal);
      this.assertBudgetLeft(state.usage);

      const turn = await this.provider.complete(
        {
          system: input.system,
          transcript,
          tools: specs,
          maxTokens: this.options.maxTokens,
        },
        input.signal,
      );
      addUsage(state.usage, turn.usage);

      // Checked before any tool runs: a refused or truncated turn can carry a
      // tool call cut off mid-input, which must never be executed.
      if (turn.stopReason === "refusal") {
        throw new AgentError("Model refused the request", AGENT_ERROR_CODES.refused);
      }
      if (turn.stopReason === "max_tokens") {
        throw new AgentError(
          `Model output hit the ${this.options.maxTokens} token cap before finishing`,
          AGENT_ERROR_CODES.truncated,
        );
      }
      if (turn.stopReason !== "tool_use" || turn.toolCalls.length === 0) {
        return this.outcome(state, iteration);
      }

      transcript.push({
        role: "assistant",
        text: turn.text,
        toolCalls: turn.toolCalls,
        replay: turn.replay,
      });

      // Sequential on purpose: a side-effecting call must finish (and mark the
      // run mutated) before the next one starts, so a failure mid-turn knows
      // exactly what already happened.
      const outcomes: ToolOutcome[] = [];
      let finished = false;
      for (const call of turn.toolCalls) {
        const result = await this.perform(call, tools.get(call.name), state, input);
        outcomes.push(result.outcome);
        if (result.terminal) finished = true;
      }
      if (finished) return this.outcome(state, iteration);

      // All results in one entry: providers need them in a single message, and
      // splitting them teaches the model to stop issuing parallel calls.
      transcript.push({ role: "tool", outcomes });
    }

    throw new AgentError(
      `Agent loop exceeded ${this.options.maxIterations} iterations`,
      AGENT_ERROR_CODES.iterationCap,
    );
  }

  private async perform(
    call: ToolCall,
    tool: AgentTool | undefined,
    state: RunState,
    input: AgentRunInput,
  ): Promise<{ outcome: ToolOutcome; terminal: boolean }> {
    const reject = (reason: string) => {
      logger.warn(
        { traceId: input.traceId, tool: call.name, reason },
        "Tool call rejected, handing back to the model",
      );
      return {
        outcome: { callId: call.id, output: reason, isError: true },
        terminal: false,
      };
    };

    if (!tool) return reject(`Unknown tool "${call.name}". Use only the tools provided.`);

    const used = state.callCounts.get(tool.name) ?? 0;
    if (tool.maxCallsPerRun !== undefined && used >= tool.maxCallsPerRun) {
      return reject(
        `Not performed: ${tool.name} may be used at most ${tool.maxCallsPerRun} time(s) per conversation turn, and that limit is reached.`,
      );
    }

    const parsed = tool.schema.safeParse(call.input);
    if (!parsed.success) {
      return reject(`Invalid arguments for ${tool.name}: ${describeIssues(parsed.error)}`);
    }

    logger.info({ traceId: input.traceId, tool: tool.name }, "Agent calling tool");
    try {
      const output = await tool.execute(parsed.data, input.signal);
      state.callCounts.set(tool.name, used + 1);
      state.actions.push(tool.name);
      if (tool.sideEffects) state.mutated = true;
      return {
        outcome: { callId: call.id, output, isError: false },
        terminal: tool.terminal === true,
      };
    } catch (error) {
      if (error instanceof ToolRejection) return reject(error.message);
      throw error;
    }
  }

  private outcome(state: RunState, iterations: number): AgentOutcome {
    return {
      summary: summarise(state.actions),
      usage: { ...state.usage },
      iterations,
      actions: [...state.actions],
      mutated: state.mutated,
    };
  }

  private assertTimeLeft(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new AgentError("Run exceeded its wall-clock budget", AGENT_ERROR_CODES.timeout);
    }
  }

  private assertBudgetLeft(usage: TokenUsage): void {
    const budget = this.options.maxRunTokens;
    if (budget === undefined) return;
    const spent = usage.inputTokens + usage.outputTokens;
    if (spent >= budget) {
      throw new AgentError(
        `Run spent ${spent} tokens, exhausting its ${budget} token budget`,
        AGENT_ERROR_CODES.budgetExceeded,
      );
    }
  }

  /**
   * Normalises any failure into an AgentError stamped with the run's state. An
   * aborted signal wins over whatever the aborted call threw: the SDK or axios
   * reports a cancelled request as its own error type, but the cause is the
   * run's deadline and the code must say so.
   */
  private asFailure(error: unknown, state: RunState, signal?: AbortSignal): AgentError {
    let failure: AgentError;
    if (signal?.aborted && !(error instanceof AgentError && error.code === AGENT_ERROR_CODES.timeout)) {
      failure = new AgentError("Run exceeded its wall-clock budget", AGENT_ERROR_CODES.timeout, {
        cause: error,
      });
    } else if (error instanceof AgentError) {
      failure = error;
    } else {
      failure = new AgentError(
        `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
        AGENT_ERROR_CODES.toolFailed,
        { cause: error },
      );
    }
    failure.mutated = state.mutated;
    failure.usage = { ...state.usage };
    return failure;
  }
}

const addUsage = (total: Required<TokenUsage>, turn: TokenUsage): void => {
  total.inputTokens += turn.inputTokens;
  total.outputTokens += turn.outputTokens;
  total.cacheReadTokens += turn.cacheReadTokens ?? 0;
  total.cacheWriteTokens += turn.cacheWriteTokens ?? 0;
};

const summarise = (actions: string[]): string =>
  actions.length === 0 ? "no action taken" : `actions: ${actions.join(", ")}`;
