import Anthropic from "@anthropic-ai/sdk";
import { ApiError, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { AGENT_ERROR_CODES, AgentError } from "../agent.errors.js";
import type { ChatRequest } from "../llm.port.js";
import {
  AnthropicProvider,
  toStrictSchema,
  type AnthropicCreate,
} from "../providers/anthropic.provider.js";
import { GeminiProvider } from "../providers/gemini.provider.js";

const REQUEST: ChatRequest = {
  system: "You are a receptionist.",
  transcript: [{ role: "user", text: "Ciao" }],
  tools: [
    {
      name: "respond_whatsapp",
      description: "Reply",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string", minLength: 1, maxLength: 4000 } },
        required: ["message"],
        additionalProperties: false,
      },
    },
  ],
  maxTokens: 1_000,
};

type Message = Anthropic.Beta.BetaMessage;

const anthropicMessage = (overrides: Partial<Message>): Message =>
  ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [],
    stop_reason: "end_turn",
    stop_details: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  }) as Message;

const anthropic = (create: AnthropicCreate, refusalFallback = true) =>
  new AnthropicProvider({
    apiKey: undefined,
    model: "claude-opus-5",
    effort: "medium",
    refusalFallback,
    create,
  });

const failure = async (promise: Promise<unknown>): Promise<AgentError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AgentError);
  return error as AgentError;
};

describe("AnthropicProvider", () => {
  it("sends adaptive thinking, effort, strict tools, a cached system prompt and the fallback beta", async () => {
    const create = vi.fn<AnthropicCreate>().mockResolvedValue(anthropicMessage({}));
    const signal = new AbortController().signal;

    await anthropic(create).complete(REQUEST, signal);

    const [params, options] = create.mock.calls[0]!;
    expect(params).toMatchObject({
      model: "claude-opus-5",
      max_tokens: 1_000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: REQUEST.system, cache_control: { type: "ephemeral" } }],
    });
    expect(params).not.toHaveProperty("temperature");
    expect(params.tools?.[0]).toMatchObject({ name: "respond_whatsapp", strict: true });
    // Constraints strict mode rejects are stripped (and enforced by the loop instead).
    expect(JSON.stringify(params.tools)).not.toContain("maxLength");
    expect(options.signal).toBe(signal);
  });

  it("omits the fallback beta when disabled", async () => {
    const create = vi.fn<AnthropicCreate>().mockResolvedValue(anthropicMessage({}));
    await anthropic(create, false).complete(REQUEST);
    expect(create.mock.calls[0]![0]).not.toHaveProperty("fallbacks");
    expect(create.mock.calls[0]![0]).not.toHaveProperty("betas");
  });

  it.each([
    ["end_turn", "end_turn"],
    ["stop_sequence", "end_turn"],
    ["tool_use", "tool_use"],
    ["max_tokens", "max_tokens"],
    ["model_context_window_exceeded", "max_tokens"],
    ["refusal", "refusal"],
  ] as const)("maps stop reason %s to %s", async (stop, expected) => {
    const create = vi.fn<AnthropicCreate>().mockResolvedValue(anthropicMessage({ stop_reason: stop }));
    const turn = await anthropic(create).complete(REQUEST);
    expect(turn.stopReason).toBe(expected);
  });

  it("rejects stop reasons the adapter cannot continue from", async () => {
    const create = vi
      .fn<AnthropicCreate>()
      .mockResolvedValue(anthropicMessage({ stop_reason: "pause_turn" }));
    const error = await failure(anthropic(create).complete(REQUEST));
    expect(error.code).toBe(AGENT_ERROR_CODES.unsupportedStopReason);
  });

  it("reports total input including cached spans, and cache reads/writes separately", async () => {
    const create = vi.fn<AnthropicCreate>().mockResolvedValue(
      anthropicMessage({
        usage: {
          input_tokens: 50,
          output_tokens: 20,
          cache_read_input_tokens: 1_000,
          cache_creation_input_tokens: 200,
        } as Message["usage"],
      }),
    );
    const turn = await anthropic(create).complete(REQUEST);
    expect(turn.usage).toEqual({
      inputTokens: 1_250,
      outputTokens: 20,
      cacheReadTokens: 1_000,
      cacheWriteTokens: 200,
    });
  });

  it("extracts tool calls and replays the raw content blocks, thinking included, on the next turn", async () => {
    const content = [
      { type: "thinking", thinking: "", signature: "sig-abc" },
      { type: "tool_use", id: "toolu_1", name: "respond_whatsapp", input: { message: "Ciao!" } },
    ] as Message["content"];
    const create = vi
      .fn<AnthropicCreate>()
      .mockResolvedValueOnce(anthropicMessage({ content, stop_reason: "tool_use" }))
      .mockResolvedValueOnce(anthropicMessage({}));
    const provider = anthropic(create);

    const turn = await provider.complete(REQUEST);
    expect(turn.toolCalls).toEqual([
      { id: "toolu_1", name: "respond_whatsapp", input: { message: "Ciao!" } },
    ]);

    await provider.complete({
      ...REQUEST,
      transcript: [
        ...REQUEST.transcript,
        { role: "assistant", text: turn.text, toolCalls: turn.toolCalls, replay: turn.replay },
        { role: "tool", outcomes: [{ callId: "toolu_1", output: "Done.", isError: false }] },
      ],
    });

    const messages = create.mock.calls[1]![0].messages;
    expect(messages[1]).toEqual({ role: "assistant", content });
    expect(messages[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "Done.", is_error: false }],
    });
  });

  it.each([
    ["429 rate limit", Anthropic.APIError.generate(429, { type: "error" }, "rate limited", new Headers()), true],
    ["529 overloaded", Anthropic.APIError.generate(529, { type: "error" }, "overloaded", new Headers()), true],
    ["500 server error", Anthropic.APIError.generate(500, { type: "error" }, "boom", new Headers()), true],
    ["connection reset", new Anthropic.APIConnectionError({ message: "socket hang up" }), true],
    ["400 bad request", Anthropic.APIError.generate(400, { type: "error" }, "bad", new Headers()), false],
    ["401 unauthorized", Anthropic.APIError.generate(401, { type: "error" }, "no", new Headers()), false],
    ["user abort", new Anthropic.APIUserAbortError(), false],
  ])("wraps %s as AGENT_PROVIDER_FAILED with cause (retryable=%s)", async (_name, cause, retryable) => {
    const create = vi.fn<AnthropicCreate>().mockRejectedValue(cause);
    const error = await failure(anthropic(create).complete(REQUEST));
    expect(error.code).toBe(AGENT_ERROR_CODES.providerFailed);
    expect(error.retryable).toBe(retryable);
    expect(error.cause).toBe(cause);
  });

  it("requires an API key when no client is injected", () => {
    expect(
      () =>
        new AnthropicProvider({
          apiKey: undefined,
          model: "claude-opus-5",
          effort: "high",
          refusalFallback: true,
        }),
    ).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("toStrictSchema", () => {
  it("strips unsupported keywords but keeps property names that look like keywords", () => {
    const schema = {
      type: "object",
      $schema: "https://json-schema.org/draft/2020-12/schema",
      properties: {
        pattern: { type: "string", pattern: "^a" },
        items: { type: "array", minItems: 2, maxItems: 5, items: { type: "integer", minimum: 0 } },
        flag: { type: "array", minItems: 1, items: { type: "string", enum: ["minimum"] } },
      },
      required: ["pattern"],
      additionalProperties: false,
    };
    expect(toStrictSchema(schema)).toEqual({
      type: "object",
      properties: {
        pattern: { type: "string" },
        items: { type: "array", items: { type: "integer" } },
        flag: { type: "array", minItems: 1, items: { type: "string", enum: ["minimum"] } },
      },
      required: ["pattern"],
      additionalProperties: false,
    });
  });
});

describe("GeminiProvider", () => {
  const response = (overrides: Partial<GenerateContentResponse>) =>
    overrides as GenerateContentResponse;

  const gemini = (generate: (params: GenerateContentParameters) => Promise<GenerateContentResponse>) =>
    new GeminiProvider({ apiKey: undefined, model: "gemini-test", generate });

  it("treats a function call as tool_use and replays its thought signature verbatim", async () => {
    const parts = [
      { thought: true, text: "internal reasoning" },
      {
        thoughtSignature: "sig-123",
        functionCall: { name: "respond_whatsapp", args: { message: "Ciao!" } },
      },
    ];
    const generate = vi
      .fn<(params: GenerateContentParameters) => Promise<GenerateContentResponse>>()
      .mockResolvedValueOnce(
        response({
          candidates: [{ content: { role: "model", parts }, finishReason: "STOP" as never }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 30, cachedContentTokenCount: 40 },
        }),
      )
      .mockResolvedValueOnce(
        response({ candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" as never }] }),
      );
    const provider = gemini(generate);

    const turn = await provider.complete(REQUEST);
    expect(turn.stopReason).toBe("tool_use");
    expect(turn.text).toBe("");
    expect(turn.toolCalls).toEqual([
      { id: "respond_whatsapp_0", name: "respond_whatsapp", input: { message: "Ciao!" } },
    ]);
    expect(turn.usage).toEqual({ inputTokens: 100, outputTokens: 40, cacheReadTokens: 40 });

    await provider.complete({
      ...REQUEST,
      transcript: [
        ...REQUEST.transcript,
        { role: "assistant", text: "", toolCalls: turn.toolCalls, replay: turn.replay },
        { role: "tool", outcomes: [{ callId: "respond_whatsapp_0", output: "Done.", isError: false }] },
      ],
    });
    const contents = generate.mock.calls[1]![0].contents as Array<{ role: string; parts: unknown[] }>;
    expect(contents[1]).toEqual({ role: "model", parts });
    expect(contents[2]).toEqual({
      role: "user",
      parts: [{ functionResponse: { name: "respond_whatsapp", response: { output: "Done." } } }],
    });
  });

  it.each([
    ["STOP", "end_turn"],
    ["MAX_TOKENS", "max_tokens"],
    ["SAFETY", "refusal"],
  ] as const)("maps finish reason %s to %s", async (finishReason, expected) => {
    const generate = vi.fn().mockResolvedValue(
      response({ candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: finishReason as never }] }),
    );
    expect((await gemini(generate).complete(REQUEST)).stopReason).toBe(expected);
  });

  it.each([
    [503, true],
    [429, true],
    [400, false],
  ])("wraps an ApiError %s with cause (retryable=%s)", async (status, retryable) => {
    const cause = new ApiError({ message: "failed", status });
    const generate = vi.fn().mockRejectedValue(cause);
    const error = await failure(gemini(generate).complete(REQUEST));
    expect(error.code).toBe(AGENT_ERROR_CODES.providerFailed);
    expect(error.retryable).toBe(retryable);
    expect(error.cause).toBe(cause);
  });
});
