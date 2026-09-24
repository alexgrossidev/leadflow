/**
 * Vendor-neutral LLM contract.
 *
 * The port is deliberately a *single-shot completion*, not an agent run: the
 * loop, tool dispatch, validation, budgets and usage accounting live in
 * `loop.ts` so every provider behaves identically. Swapping Anthropic for
 * Gemini means writing one adapter that satisfies `LlmProvider`; the engine
 * does not change.
 *
 * Nothing in this file may reference a vendor SDK or a vendor-specific concept.
 */

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal";

export interface TokenUsage {
  /** Total prompt tokens, including any the provider served from or wrote to cache. */
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens served from cache (already counted in inputTokens). */
  cacheReadTokens?: number;
  /** Prompt tokens written to cache (already counted in inputTokens). */
  cacheWriteTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Unvalidated model output; the loop validates it against the tool's schema. */
  input: unknown;
}

export interface ToolOutcome {
  callId: string;
  output: string;
  isError: boolean;
}

export type TranscriptEntry =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      toolCalls: ToolCall[];
      /**
       * Opaque state the provider needs replayed verbatim on the next request
       * (Anthropic thinking blocks, Gemini thought signatures). The loop carries
       * it back untouched and never inspects it, so no vendor concept leaks
       * into the engine.
       */
      replay?: unknown;
    }
  | { role: "tool"; outcomes: ToolOutcome[] };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema describing the tool's input. Always an object schema. */
  inputSchema: { type: "object"; [keyword: string]: unknown };
}

export interface ChatRequest {
  /**
   * Stable, tenant-scoped prefix. Providers that support prompt caching set
   * their cache breakpoint at its end; callers guarantee it does not vary
   * between runs of the same tenant. Untrusted content never goes here.
   */
  system: string;
  transcript: TranscriptEntry[];
  tools: ToolSpec[];
  maxTokens: number;
}

export interface AssistantTurn {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: TokenUsage;
  /** See TranscriptEntry.replay. */
  replay?: unknown;
}

export interface LlmProvider {
  readonly id: string;
  /** `signal` aborts the call when the run's wall-clock budget is spent. */
  complete(request: ChatRequest, signal?: AbortSignal): Promise<AssistantTurn>;
}
