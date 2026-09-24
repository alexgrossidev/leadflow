import type {
  AssistantTurn,
  ChatRequest,
  LlmProvider,
  TokenUsage,
  ToolCall,
} from "../llm.port.js";

/** One scripted step: a turn to return, an error to throw, or a function of the request. */
export type FakeStep =
  | AssistantTurn
  | Error
  | ((request: ChatRequest, callIndex: number) => AssistantTurn | Promise<AssistantTurn>);

export interface FakeLlmProviderOptions {
  /** Simulated latency per call, raced against the abort signal. */
  latencyMs?: number;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/**
 * Deterministic, offline LlmProvider for tests and the no-key docker demo.
 *
 * Driven either by a script (consumed one step per call; running past its end
 * is a test bug and throws) or by a single function of the request. Every
 * request is recorded as a deep copy, so assertions see exactly what was sent
 * at that call even though the loop keeps mutating its transcript. Honours
 * AbortSignal before and during a call, like a real network client.
 */
export class FakeLlmProvider implements LlmProvider {
  readonly id = "fake";
  readonly calls: ChatRequest[] = [];
  private readonly steps: FakeStep[];
  private readonly responder?: FakeStep;

  constructor(
    script: FakeStep[] | FakeStep = demoResponder,
    private readonly options: FakeLlmProviderOptions = {},
  ) {
    if (Array.isArray(script)) {
      this.steps = [...script];
    } else {
      this.steps = [];
      this.responder = script;
    }
  }

  async complete(request: ChatRequest, signal?: AbortSignal): Promise<AssistantTurn> {
    throwIfAborted(signal);
    const callIndex = this.calls.length;
    this.calls.push(structuredClone(request));

    if (this.options.latencyMs) await delay(this.options.latencyMs, signal);

    const step = this.responder ?? this.steps.shift();
    if (!step) {
      throw new Error(`FakeLlmProvider script exhausted at call ${callIndex + 1}`);
    }
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(request, callIndex) : step;
  }
}

/** Builds a turn that calls the given tools. */
export const toolTurn = (
  calls: Array<Pick<ToolCall, "name" | "input"> & { id?: string }>,
  usage: TokenUsage = ZERO_USAGE,
): AssistantTurn => ({
  text: "",
  toolCalls: calls.map((call, index) => ({
    id: call.id ?? `call_${index + 1}`,
    name: call.name,
    input: call.input,
  })),
  stopReason: "tool_use",
  usage,
});

/** Builds a final turn with no tool calls. */
export const endTurn = (
  stopReason: AssistantTurn["stopReason"] = "end_turn",
  usage: TokenUsage = ZERO_USAGE,
): AssistantTurn => ({ text: "", toolCalls: [], stopReason, usage });

/**
 * Default behaviour when LLM_PROVIDER=fake: enough to exercise the pipeline
 * end to end without a vendor. It answers a receptionist run with one polite
 * holding reply, and marks every onboarding field as needing a real model.
 */
export const demoResponder = (request: ChatRequest): AssistantTurn => {
  const last = request.transcript.at(-1);
  if (last?.role === "tool") return endTurn();

  const offered = new Set(request.tools.map((tool) => tool.name));
  if (offered.has("respond_whatsapp")) {
    return toolTurn([
      {
        name: "respond_whatsapp",
        input: {
          message:
            "Thanks for your message! This is an automated demo reply; a member of the team will follow up shortly.",
        },
      },
    ]);
  }
  if (offered.has("report_missing_info")) {
    return toolTurn([
      {
        name: "report_missing_info",
        input: { missing: ["Demo mode (LLM_PROVIDER=fake): no model parsed this field."] },
      },
    ]);
  }
  return endTurn();
};

const abortError = (signal?: AbortSignal): Error =>
  signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError(signal);
};

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
