import { describe, expect, it, vi } from "vitest";
import { GRPC_UNAVAILABLE, withGrpcRetry } from "./grpc.retry.js";

const grpcError = (code: number) => Object.assign(new Error(`code ${code}`), { code });

function harness() {
  const delays: number[] = [];
  const options = {
    maxAttempts: 4,
    baseDelayMs: 100,
    maxDelayMs: 250,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    random: () => 1,
  };
  return { delays, options };
}

describe("withGrpcRetry", () => {
  it("returns the first successful result without sleeping", async () => {
    const { delays, options } = harness();
    await expect(withGrpcRetry(async () => "ok", {}, options)).resolves.toBe("ok");
    expect(delays).toEqual([]);
  });

  it("retries UNAVAILABLE and succeeds once the gateway is back", async () => {
    const { delays, options } = harness();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(grpcError(GRPC_UNAVAILABLE))
      .mockRejectedValueOnce(grpcError(GRPC_UNAVAILABLE))
      .mockResolvedValue("ok");

    await expect(withGrpcRetry(fn, {}, options)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([100, 200]);
  });

  it.each([
    ["INTERNAL", 13],
    ["DEADLINE_EXCEEDED", 4],
    ["INVALID_ARGUMENT", 3],
  ])("does not retry %s", async (_name, code) => {
    const { delays, options } = harness();
    const fn = vi.fn<() => Promise<void>>().mockRejectedValue(grpcError(code));
    await expect(withGrpcRetry(fn, {}, options)).rejects.toMatchObject({ code });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("does not retry errors without a gRPC code", async () => {
    const { options } = harness();
    const fn = vi.fn<() => Promise<void>>().mockRejectedValue(new Error("rejected batch"));
    await expect(withGrpcRetry(fn, {}, options)).rejects.toThrow("rejected batch");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts with the last error, backoff capped at maxDelayMs", async () => {
    const { delays, options } = harness();
    const fn = vi.fn<() => Promise<void>>().mockRejectedValue(grpcError(GRPC_UNAVAILABLE));
    await expect(withGrpcRetry(fn, {}, options)).rejects.toMatchObject({ code: GRPC_UNAVAILABLE });
    expect(fn).toHaveBeenCalledTimes(4);
    // 100, 200, then 400 capped to 250.
    expect(delays).toEqual([100, 200, 250]);
  });

  it("applies jitter within [backoff/2, backoff]", async () => {
    const { delays, options } = harness();
    const fn = vi.fn<() => Promise<void>>().mockRejectedValue(grpcError(GRPC_UNAVAILABLE));
    await expect(withGrpcRetry(fn, {}, { ...options, random: () => 0 })).rejects.toBeDefined();
    expect(delays).toEqual([50, 100, 125]);
  });
});
