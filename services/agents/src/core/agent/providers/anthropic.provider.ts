import Anthropic from "@anthropic-ai/sdk";
import { logger } from "#core/logger";
import { AGENT_ERROR_CODES, AgentError } from "../agent.errors.js";
import type {
  AssistantTurn,
  ChatRequest,
  LlmProvider,
  StopReason,
  ToolCall,
  ToolSpec,
  TranscriptEntry,
} from "../llm.port.js";
import type { AgentEffort } from "#config/agent";

type CreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
type Message = Anthropic.Beta.BetaMessage;

/** The one SDK call the adapter makes; injectable so tests can stub the vendor. */
export type AnthropicCreate = (
  params: CreateParams,
  options: { signal?: AbortSignal },
) => Promise<Message>;

export interface AnthropicProviderOptions {
  apiKey: string | undefined;
  model: string;
  effort: AgentEffort;
  /** Opt into server-side refusal fallbacks (`fallbacks: "default"`). */
  refusalFallback: boolean;
  /** Replaces the SDK client (tests). */
  create?: AnthropicCreate;
}

/** Gates `fallbacks: "default"`; the array form uses a different header. */
const REFUSAL_FALLBACK_BETA = "server-side-fallback-2026-07-01";

const STOP_REASONS: Partial<Record<string, StopReason>> = {
  end_turn: "end_turn",
  stop_sequence: "end_turn",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  // The prompt no longer fits the context window: the same outcome for the
  // loop as running out of output tokens, the turn is incomplete.
  model_context_window_exceeded: "max_tokens",
  refusal: "refusal",
};

/**
 * Keywords strict tool use does not accept. They are stripped from what the
 * API sees and still enforced client-side, because the loop validates every
 * call against the tool's full schema before executing it (the same approach
 * the SDK's own zod helpers take).
 */
const STRICT_UNSUPPORTED = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
]);

export const toStrictSchema = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  if (schema === null || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (STRICT_UNSUPPORTED.has(key)) continue;
    // Only 0 or 1 is supported as an array minimum.
    if (key === "minItems" && typeof value === "number" && value > 1) continue;
    if (key === "properties" || key === "$defs") {
      // Keys here are property names, not keywords: a property called
      // "pattern" must survive.
      out[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, sub]) => [
          name,
          toStrictSchema(sub),
        ]),
      );
    } else {
      // enum/required/const members are data, not schemas.
      out[key] =
        key === "enum" || key === "required" || key === "const"
          ? value
          : toStrictSchema(value);
    }
  }
  return out;
};

/**
 * Anthropic Messages API adapter.
 *
 * - Adaptive thinking with a configurable effort; no sampling parameters
 *   (current models reject temperature/top_p/top_k).
 * - `strict: true` tools, so a Claude tool call always matches its schema.
 * - The system prompt carries a cache breakpoint: it is the stable, tenant-
 *   scoped prefix (tools render before it and are fixed per run shape), so a
 *   tenant's second message reads the whole prefix from cache.
 * - Each assistant turn's content blocks are replayed verbatim. With thinking
 *   on, the API requires the thinking blocks that preceded a tool call to come
 *   back unmodified alongside it; editing history also invalidates preserved
 *   thinking on newer models. Keeping the raw blocks makes the transcript
 *   append-only by construction.
 */
export class AnthropicProvider implements LlmProvider {
  readonly id = "anthropic";
  private readonly create: AnthropicCreate;

  constructor(private readonly options: AnthropicProviderOptions) {
    if (options.create) {
      this.create = options.create;
      return;
    }
    if (!options.apiKey) {
      throw new AgentError(
        "ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic",
        AGENT_ERROR_CODES.providerMisconfigured,
      );
    }
    // The SDK's own per-request retries (2, honouring retry-after) stay on:
    // re-sending one completion never repeats a tool effect. The engine's
    // run-level retry is the second line, for failures that outlast them.
    const client = new Anthropic({ apiKey: options.apiKey });
    this.create = (params, requestOptions) =>
      client.beta.messages.create(params, requestOptions);
  }

  async complete(request: ChatRequest, signal?: AbortSignal): Promise<AssistantTurn> {
    const response = await this.send(request, signal);

    const stopReason = STOP_REASONS[response.stop_reason ?? ""];
    if (!stopReason) {
      // pause_turn / compaction only occur with server tools or compaction,
      // neither of which this adapter enables.
      throw new AgentError(
        `Unsupported stop reason "${response.stop_reason}"`,
        AGENT_ERROR_CODES.unsupportedStopReason,
      );
    }
    if (stopReason === "refusal") {
      // Category only: the explanation can quote the prompt.
      logger.warn(
        { model: response.model, category: response.stop_details?.category ?? null },
        "Anthropic declined the request",
      );
    }

    const text: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of response.content) {
      if (block.type === "text") text.push(block.text);
      if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    const usage = response.usage;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    return {
      text: text.join("\n"),
      toolCalls,
      stopReason,
      usage: {
        // input_tokens is only the uncached remainder; cost per tenant has to
        // include the cached spans or a cache hit looks free.
        inputTokens: usage.input_tokens + cacheRead + cacheWrite,
        outputTokens: usage.output_tokens,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
      },
      replay: response.content,
    };
  }

  private async send(request: ChatRequest, signal?: AbortSignal): Promise<Message> {
    const params: CreateParams = {
      model: this.options.model,
      max_tokens: request.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: this.options.effort },
      system: [
        { type: "text", text: request.system, cache_control: { type: "ephemeral" } },
      ],
      tools: request.tools.map(toTool),
      messages: request.transcript.map(toMessage),
      ...(this.options.refusalFallback
        ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: "default" as const }
        : {}),
    };
    try {
      return await this.create(params, { signal });
    } catch (error) {
      throw new AgentError(
        `Anthropic request failed: ${describe(error)}`,
        AGENT_ERROR_CODES.providerFailed,
        { cause: error, retryable: isTransient(error) },
      );
    }
  }
}

/**
 * 408 request timeout, 409 conflict (the SDK's own retry set), 429 rate limit,
 * 5xx including 529 overloaded, and connection failures are worth another
 * attempt. A user abort is not: it is the run's deadline.
 */
export const isTransient = (error: unknown): boolean => {
  if (error instanceof Anthropic.APIUserAbortError) return false;
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return false;
};

const describe = (error: unknown): string =>
  error instanceof Anthropic.APIError && error.status
    ? `${error.status} ${error.name}`
    : error instanceof Error
      ? error.message
      : String(error);

const toTool = (tool: ToolSpec): Anthropic.Beta.BetaTool => ({
  name: tool.name,
  description: tool.description,
  input_schema: toStrictSchema(tool.inputSchema) as Anthropic.Beta.BetaTool.InputSchema,
  strict: true,
});

const toMessage = (entry: TranscriptEntry): Anthropic.Beta.BetaMessageParam => {
  if (entry.role === "user") {
    return { role: "user", content: [{ type: "text", text: entry.text }] };
  }

  if (entry.role === "assistant") {
    if (Array.isArray(entry.replay)) {
      return {
        role: "assistant",
        content: entry.replay as Anthropic.Beta.BetaContentBlockParam[],
      };
    }
    // A turn this adapter did not produce (seeded conversation history).
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (entry.text) content.push({ type: "text", text: entry.text });
    for (const call of entry.toolCalls) {
      content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    }
    return { role: "assistant", content };
  }

  // Tool results travel back as one user turn, all of them together.
  return {
    role: "user",
    content: entry.outcomes.map((outcome) => ({
      type: "tool_result" as const,
      tool_use_id: outcome.callId,
      content: outcome.output,
      is_error: outcome.isError,
    })),
  };
};
