import { describe, expect, it, vi } from "vitest";
import { AGENT_ERROR_CODES, AgentError } from "../agent.errors.js";
import { AgentLoop } from "../loop.js";
import { FakeLlmProvider, endTurn, toolTurn } from "../providers/fake.provider.js";
import { backoffDelay, shouldRetry, withRetry, type RetryOptions } from "../retry.js";
import { recordingTool, usage } from "./helpers.js";

const transient = () =>
  new AgentError("503", AGENT_ERROR_CODES.providerFailed, { retryable: true });

const noWait: Pick<RetryOptions, "sleep" | "random"> = {
  sleep: async () => undefined,
  random: () => 0.5,
};

describe("shouldRetry", () => {
  it("retries only transient provider failures that have not mutated anything", () => {
    expect(shouldRetry(transient())).toBe(true);

    const mutated = transient();
    mutated.mutated = true;
    expect(shouldRetry(mutated)).toBe(false);

    expect(shouldRetry(new AgentError("400", AGENT_ERROR_CODES.providerFailed))).toBe(false);
    expect(shouldRetry(new AgentError("t", AGENT_ERROR_CODES.timeout, { retryable: true }))).toBe(false);
    expect(shouldRetry(new AgentError("r", AGENT_ERROR_CODES.refused))).toBe(false);
    expect(shouldRetry(new AgentError("g", AGENT_ERROR_CODES.toolFailed, { retryable: true }))).toBe(false);
    expect(shouldRetry(new Error("plain"))).toBe(false);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially, is capped, and is jittered within [0, ceiling)", () => {
    const options = { baseDelayMs: 100, maxDelayMs: 1_000 };
    expect(backoffDelay(0, { ...options, random: () => 0.999 })).toBe(99);
    expect(backoffDelay(2, { ...options, random: () => 0.5 })).toBe(200);
    expect(backoffDelay(10, { ...options, random: () => 0.999 })).toBe(999);
    expect(backoffDelay(3, { ...options, random: () => 0 })).toBe(0);
  });
});

describe("withRetry around the agent loop", () => {
  const run = (provider: FakeLlmProvider, tools: ReturnType<typeof recordingTool>["tool"][]) =>
    new AgentLoop(provider, { maxIterations: 5, maxTokens: 100 }).run({
      system: "s",
      transcript: [],
      tools,
    });

  it("never retries once a side-effecting tool succeeded, however transient the failure", async () => {
    const { tool, calls } = recordingTool("respond_whatsapp");
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "respond_whatsapp", input: { text: "hello" } }], usage(10, 1)),
      transient(),
      // Would be consumed by a (wrong) retry.
      toolTurn([{ name: "respond_whatsapp", input: { text: "hello" } }]),
      endTurn(),
    ]);
    const onRetry = vi.fn();

    const error = await withRetry(() => run(provider, [tool]), {
      attempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 10,
      onRetry,
      ...noWait,
    }).then(
      () => undefined,
      (e: unknown) => e as AgentError,
    );

    expect(error?.code).toBe(AGENT_ERROR_CODES.providerFailed);
    expect(error?.mutated).toBe(true);
    expect(onRetry).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(provider.calls).toHaveLength(2);
  });

  it("retries a transient failure after a read-only tool, and accumulates usage across attempts", async () => {
    const { tool, calls } = recordingTool("submit_details", { sideEffects: false });
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "submit_details", input: { text: "draft" } }], usage(10, 2)),
      transient(),
      toolTurn([{ name: "submit_details", input: { text: "draft" } }], usage(10, 2)),
      endTurn("end_turn", usage(5, 1)),
    ]);

    const { value, attempts } = await withRetry(() => run(provider, [tool]), {
      attempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 10,
      ...noWait,
    });

    expect(attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(value.usage).toMatchObject({ inputTokens: 25, outputTokens: 5 });
  });

  it("gives up after the attempt budget and reports the last error with total usage", async () => {
    let attempt = 0;
    const error = await withRetry(
      async () => {
        attempt++;
        const failure = transient();
        failure.usage = usage(1, 1);
        throw failure;
      },
      { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, ...noWait },
    ).then(
      () => undefined,
      (e: unknown) => e as AgentError,
    );

    expect(attempt).toBe(3);
    expect(error?.usage).toMatchObject({ inputTokens: 3, outputTokens: 3 });
  });

  it("does not start another attempt once the deadline has passed", async () => {
    const controller = new AbortController();
    let attempt = 0;
    const promise = withRetry(
      async () => {
        attempt++;
        controller.abort();
        throw transient();
      },
      { attempts: 5, baseDelayMs: 1, maxDelayMs: 1, signal: controller.signal, ...noWait },
    );

    await expect(promise).rejects.toBeInstanceOf(AgentError);
    expect(attempt).toBe(1);
  });
});
