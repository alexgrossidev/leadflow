import {
  ApiError,
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
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

/** The one SDK call the adapter makes; injectable so tests can stub the vendor. */
export type GeminiGenerate = (
  params: GenerateContentParameters,
) => Promise<GenerateContentResponse>;

export interface GeminiProviderOptions {
  apiKey: string | undefined;
  model: string;
  /** Replaces the SDK client (tests). */
  generate?: GeminiGenerate;
}

/**
 * Gemini adapter: a second vendor behind the same port, used by the eval
 * harness and to prove the engine is vendor-neutral. The loop, prompts, tools
 * and validation behave identically whichever provider runs.
 *
 * Gemini 3+ attaches an opaque thought signature to each functionCall part and
 * rejects a later request whose history replays the call without it. The
 * response parts are therefore kept as the turn's `replay` and sent back
 * verbatim, signatures included.
 */
export class GeminiProvider implements LlmProvider {
  readonly id = "gemini";
  private readonly generate: GeminiGenerate;

  constructor(private readonly options: GeminiProviderOptions) {
    if (options.generate) {
      this.generate = options.generate;
      return;
    }
    if (!options.apiKey) {
      throw new AgentError(
        "GEMINI_API_KEY is required when LLM_PROVIDER=gemini",
        AGENT_ERROR_CODES.providerMisconfigured,
      );
    }
    const client = new GoogleGenAI({ apiKey: options.apiKey });
    this.generate = (params) => client.models.generateContent(params);
  }

  async complete(request: ChatRequest, signal?: AbortSignal): Promise<AssistantTurn> {
    const response = await this.send(request, signal);

    const candidate = response.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];

    const text: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      // Thought summaries are internal reasoning, not answer content.
      if (part.text && !part.thought) text.push(part.text);

      const call = part.functionCall;
      if (call?.name) {
        toolCalls.push({
          // Gemini omits the id on single calls; synthesise a stable one so the
          // loop can pair this call with its result.
          id: call.id ?? `${call.name}_${toolCalls.length}`,
          name: call.name,
          input: call.args ?? {},
        });
      }
    }

    const usage = response.usageMetadata;
    const cached = usage?.cachedContentTokenCount ?? 0;
    return {
      text: text.join("\n"),
      toolCalls,
      stopReason: toStopReason(candidate?.finishReason, toolCalls.length > 0),
      usage: {
        // promptTokenCount already folds in any cached prefix. Thoughts are
        // billed as output, so add them or thinking looks free.
        inputTokens: usage?.promptTokenCount ?? 0,
        outputTokens:
          (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        cacheReadTokens: cached,
      },
      replay: parts,
    };
  }

  private async send(
    request: ChatRequest,
    signal?: AbortSignal,
  ): Promise<GenerateContentResponse> {
    try {
      return await this.generate({
        model: this.options.model,
        contents: toContents(request.transcript),
        config: {
          abortSignal: signal,
          systemInstruction: request.system,
          maxOutputTokens: request.maxTokens,
          tools: [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }],
        },
      });
    } catch (error) {
      throw new AgentError(
        `Gemini request failed: ${error instanceof ApiError ? `${error.status}` : error instanceof Error ? error.message : String(error)}`,
        AGENT_ERROR_CODES.providerFailed,
        { cause: error, retryable: isTransient(error, signal) },
      );
    }
  }
}

/** 408/429/5xx from the API, or a network failure that was not our own abort. */
export const isTransient = (error: unknown, signal?: AbortSignal): boolean => {
  if (signal?.aborted) return false;
  if (error instanceof ApiError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  // fetch reports connection failures as TypeError("fetch failed").
  return error instanceof TypeError;
};

/**
 * A tool call arrives with finishReason STOP, so the presence of the call (not
 * the finish reason) is what tells the loop to keep going.
 */
const toStopReason = (finish: string | undefined, hasToolCalls: boolean): StopReason => {
  if (hasToolCalls) return "tool_use";
  switch (finish) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "IMAGE_SAFETY":
      return "refusal";
    default:
      throw new AgentError(
        `Unsupported Gemini finish reason "${finish}"`,
        AGENT_ERROR_CODES.unsupportedStopReason,
      );
  }
};

const toFunctionDeclaration = (tool: ToolSpec): FunctionDeclaration => ({
  name: tool.name,
  description: tool.description,
  // Our specs are JSON Schema; parametersJsonSchema takes them as-is, unlike
  // `parameters`, which expects Gemini's OpenAPI Schema dialect.
  parametersJsonSchema: tool.inputSchema,
});

const toContents = (transcript: TranscriptEntry[]): Content[] => {
  // Tool results carry only a call id; recover each call's name from the
  // assistant turn that issued it, since Gemini keys responses by name + order.
  const callNames = new Map<string, string>();
  const contents: Content[] = [];

  for (const entry of transcript) {
    if (entry.role === "user") {
      contents.push({ role: "user", parts: [{ text: entry.text }] });
      continue;
    }

    if (entry.role === "assistant") {
      for (const call of entry.toolCalls) callNames.set(call.id, call.name);
      if (Array.isArray(entry.replay)) {
        contents.push({ role: "model", parts: entry.replay as Part[] });
        continue;
      }
      // A turn this adapter did not produce (seeded conversation history).
      const parts: Part[] = [];
      if (entry.text) parts.push({ text: entry.text });
      for (const call of entry.toolCalls) {
        parts.push({
          functionCall: { name: call.name, args: call.input as Record<string, unknown> },
        });
      }
      contents.push({ role: "model", parts });
      continue;
    }

    // One functionResponse per outcome, in the order the calls were issued.
    contents.push({
      role: "user",
      parts: entry.outcomes.map((outcome) => ({
        functionResponse: {
          name: callNames.get(outcome.callId) ?? outcome.callId,
          // "output"/"error" are Gemini's reserved keys for success vs failure.
          response: outcome.isError ? { error: outcome.output } : { output: outcome.output },
        },
      })),
    });
  }

  return contents;
};
