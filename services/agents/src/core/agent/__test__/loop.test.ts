import { describe, expect, it } from "vitest";
import { AGENT_ERROR_CODES, AgentError, ToolRejection } from "../agent.errors.js";
import { AgentLoop, type AgentLoopOptions } from "../loop.js";
import { FakeLlmProvider, endTurn, toolTurn } from "../providers/fake.provider.js";
import { recordingTool, usage } from "./helpers.js";

const OPTIONS: AgentLoopOptions = { maxIterations: 4, maxTokens: 1_000 };

const runLoop = (provider: FakeLlmProvider, loopOptions = OPTIONS) =>
  new AgentLoop(provider, loopOptions);

const failureOf = async (promise: Promise<unknown>): Promise<AgentError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AgentError);
  return error as AgentError;
};

describe("AgentLoop", () => {
  it("runs tools until the model ends its turn and reports usage and actions", async () => {
    const { tool, calls } = recordingTool("send");
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "send", input: { text: "hi" } }], usage(10, 5)),
      endTurn("end_turn", usage(20, 2)),
    ]);

    const outcome = await runLoop(provider).run({ system: "s", transcript: [], tools: [tool] });

    expect(calls).toEqual([{ text: "hi" }]);
    expect(outcome).toMatchObject({
      summary: "actions: send",
      iterations: 2,
      mutated: true,
      usage: { inputTokens: 30, outputTokens: 7 },
    });
    // The second request carries the tool result back.
    expect(provider.calls[1]!.transcript.at(-1)).toEqual({
      role: "tool",
      outcomes: [{ callId: "call_1", output: "ok", isError: false }],
    });
  });

  it("fails with AGENT_ITERATION_CAP and records that a side effect already happened", async () => {
    const { tool } = recordingTool("send");
    const provider = new FakeLlmProvider(() => toolTurn([{ name: "send", input: { text: "x" } }], usage(1, 1)));

    const error = await failureOf(
      runLoop(provider, { maxIterations: 3, maxTokens: 100 }).run({
        system: "s",
        transcript: [],
        tools: [tool],
      }),
    );

    expect(error.code).toBe(AGENT_ERROR_CODES.iterationCap);
    expect(error.mutated).toBe(true);
    expect(error.usage).toMatchObject({ inputTokens: 3, outputTokens: 3 });
    expect(provider.calls).toHaveLength(3);
  });

  it("maps max_tokens to AGENT_TRUNCATED without running the turn's tool calls", async () => {
    const { tool, calls } = recordingTool("send");
    const provider = new FakeLlmProvider([
      { ...toolTurn([{ name: "send", input: { text: "cut off" } }]), stopReason: "max_tokens" },
    ]);

    const error = await failureOf(runLoop(provider).run({ system: "s", transcript: [], tools: [tool] }));

    expect(error.code).toBe(AGENT_ERROR_CODES.truncated);
    expect(calls).toHaveLength(0);
  });

  it("maps a refusal to AGENT_REFUSED with mutated false", async () => {
    const provider = new FakeLlmProvider([endTurn("refusal")]);
    const { tool } = recordingTool("send");

    const error = await failureOf(runLoop(provider).run({ system: "s", transcript: [], tools: [tool] }));

    expect(error.code).toBe(AGENT_ERROR_CODES.refused);
    expect(error.mutated).toBe(false);
    expect(error.retryable).toBe(false);
  });

  it("stops with AGENT_BUDGET_EXCEEDED once the run's token budget is spent", async () => {
    const { tool } = recordingTool("lookup", { sideEffects: false });
    const provider = new FakeLlmProvider(() =>
      toolTurn([{ name: "lookup", input: { text: "q" } }], usage(60, 20)),
    );

    const error = await failureOf(
      runLoop(provider, { maxIterations: 10, maxTokens: 100, maxRunTokens: 150 }).run({
        system: "s",
        transcript: [],
        tools: [tool],
      }),
    );

    expect(error.code).toBe(AGENT_ERROR_CODES.budgetExceeded);
    // 80 tokens after the first call, 160 after the second: the third never starts.
    expect(provider.calls).toHaveLength(2);
    expect(error.usage).toMatchObject({ inputTokens: 120, outputTokens: 40 });
    expect(error.mutated).toBe(false);
  });

  it("feeds a ToolRejection back to the model and lets the run resolve", async () => {
    let attempts = 0;
    const { tool } = recordingTool("send", {
      run: () => {
        attempts++;
        if (attempts === 1) throw new ToolRejection("try again without that word");
        return "sent";
      },
    });
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "send", input: { text: "bad" } }]),
      toolTurn([{ name: "send", input: { text: "good" } }]),
      endTurn(),
    ]);

    const outcome = await runLoop(provider).run({ system: "s", transcript: [], tools: [tool] });

    expect(outcome.actions).toEqual(["send"]);
    expect(provider.calls[1]!.transcript.at(-1)).toEqual({
      role: "tool",
      outcomes: [{ callId: "call_1", output: "try again without that word", isError: true }],
    });
  });

  it("rejects arguments that do not match the tool schema before executing", async () => {
    const { tool, calls } = recordingTool("send");
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "send", input: { text: "", extra: true } }]),
      endTurn(),
    ]);

    const outcome = await runLoop(provider).run({ system: "s", transcript: [], tools: [tool] });

    expect(calls).toHaveLength(0);
    expect(outcome.mutated).toBe(false);
    const result = provider.calls[1]!.transcript.at(-1);
    expect(result).toMatchObject({ role: "tool", outcomes: [{ isError: true }] });
    expect(JSON.stringify(result)).toContain("Invalid arguments for send");
  });

  it("answers an unknown tool with an error result instead of failing the run", async () => {
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "delete_everything", input: {} }]),
      endTurn(),
    ]);

    const outcome = await runLoop(provider).run({ system: "s", transcript: [], tools: [] });

    expect(outcome.summary).toBe("no action taken");
    expect(JSON.stringify(provider.calls[1]!.transcript.at(-1))).toContain("Unknown tool");
  });

  it("ends the run after a terminal tool succeeds, without another model call", async () => {
    const { tool } = recordingTool("reply", { terminal: true, maxCallsPerRun: 1 });
    const provider = new FakeLlmProvider([toolTurn([{ name: "reply", input: { text: "hi" } }])]);

    const outcome = await runLoop(provider).run({ system: "s", transcript: [], tools: [tool] });

    expect(outcome.actions).toEqual(["reply"]);
    expect(provider.calls).toHaveLength(1);
  });

  it("enforces a tool's per-run cap even within one turn", async () => {
    const { tool, calls } = recordingTool("reply", { maxCallsPerRun: 1 });
    const provider = new FakeLlmProvider([
      toolTurn([
        { name: "reply", input: { text: "one" } },
        { name: "reply", input: { text: "two" } },
      ]),
      endTurn(),
    ]);

    await runLoop(provider).run({ system: "s", transcript: [], tools: [tool] });

    expect(calls).toEqual([{ text: "one" }]);
    expect(JSON.stringify(provider.calls[1]!.transcript.at(-1))).toContain("at most 1 time");
  });

  it("fails with AGENT_TOOL_FAILED when a tool throws a non-rejection error", async () => {
    const { tool } = recordingTool("send", {
      run: () => {
        throw new Error("gateway down");
      },
    });
    const provider = new FakeLlmProvider([toolTurn([{ name: "send", input: { text: "x" } }])]);

    const error = await failureOf(runLoop(provider).run({ system: "s", transcript: [], tools: [tool] }));

    expect(error.code).toBe(AGENT_ERROR_CODES.toolFailed);
    expect(error.mutated).toBe(false);
  });

  it("does not mark the run mutated for read-only tools", async () => {
    const { tool } = recordingTool("lookup", { sideEffects: false });
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "lookup", input: { text: "q" } }]),
      new AgentError("boom", AGENT_ERROR_CODES.providerFailed, { retryable: true }),
    ]);

    const error = await failureOf(runLoop(provider).run({ system: "s", transcript: [], tools: [tool] }));

    expect(error.mutated).toBe(false);
    expect(error.retryable).toBe(true);
  });

  describe("deadline", () => {
    it("fails a pre-aborted run with AGENT_TIMEOUT before calling the provider", async () => {
      const provider = new FakeLlmProvider([endTurn()]);
      const controller = new AbortController();
      controller.abort();

      const error = await failureOf(
        runLoop(provider).run({ system: "s", transcript: [], tools: [], signal: controller.signal }),
      );

      expect(error.code).toBe(AGENT_ERROR_CODES.timeout);
      expect(provider.calls).toHaveLength(0);
    });

    it("classifies an abort during the provider call as AGENT_TIMEOUT, not a provider failure", async () => {
      const provider = new FakeLlmProvider([endTurn()], { latencyMs: 1_000 });

      const error = await failureOf(
        runLoop(provider).run({
          system: "s",
          transcript: [],
          tools: [],
          signal: AbortSignal.timeout(20),
        }),
      );

      expect(error.code).toBe(AGENT_ERROR_CODES.timeout);
      expect(error.retryable).toBe(false);
      expect(provider.calls).toHaveLength(1);
    });

    it("classifies an abort during a tool call as AGENT_TIMEOUT and keeps mutated", async () => {
      const controller = new AbortController();
      const { tool: sent } = recordingTool("send");
      const { tool: slow } = recordingTool("slow", {
        run: () => {
          controller.abort();
          throw new Error("request aborted");
        },
      });
      const provider = new FakeLlmProvider([
        toolTurn([
          { name: "send", input: { text: "a" } },
          { name: "slow", input: { text: "b" } },
        ]),
      ]);

      const error = await failureOf(
        runLoop(provider).run({
          system: "s",
          transcript: [],
          tools: [sent, slow],
          signal: controller.signal,
        }),
      );

      expect(error.code).toBe(AGENT_ERROR_CODES.timeout);
      expect(error.mutated).toBe(true);
      expect((error.cause as Error).message).toBe("request aborted");
    });
  });
});
