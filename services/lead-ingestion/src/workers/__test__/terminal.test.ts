import { describe, it, expect, vi } from "vitest";
import { runWithTerminalHandling } from "../terminal";

class Fatal extends Error {}

const job = (attemptsMade: number) => ({
  id: "j1",
  name: "q",
  data: { leadgenId: "lg_1" },
  attemptsMade,
});

const policy = () => ({
  maxAttempts: 5,
  isFatal: (err: unknown) => err instanceof Fatal,
  onTerminal: vi.fn().mockResolvedValue(undefined),
});

describe("runWithTerminalHandling", () => {
  it("rethrows a transient failure before the last attempt without a hand-off", async () => {
    const p = policy();
    await expect(
      runWithTerminalHandling(job(0), p, () => Promise.reject(new Error("blip"))),
    ).rejects.toThrow("blip");
    expect(p.onTerminal).not.toHaveBeenCalled();
  });

  it("hands off and rethrows on the final attempt", async () => {
    const p = policy();
    await expect(
      runWithTerminalHandling(job(4), p, () => Promise.reject(new Error("blip"))),
    ).rejects.toThrow("blip");
    expect(p.onTerminal).toHaveBeenCalledWith({ leadgenId: "lg_1" }, expect.any(Error), false);
  });

  it("hands off a fatal failure at once and completes the job", async () => {
    const p = policy();
    await expect(
      runWithTerminalHandling(job(0), p, () => Promise.reject(new Fatal("bad"))),
    ).resolves.toBeUndefined();
    expect(p.onTerminal).toHaveBeenCalledWith(expect.anything(), expect.any(Fatal), true);
  });

  it("keeps a fatal job failed when the hand-off itself fails", async () => {
    const p = policy();
    p.onTerminal.mockRejectedValueOnce(new Error("db down"));
    await expect(
      runWithTerminalHandling(job(0), p, () => Promise.reject(new Fatal("bad"))),
    ).rejects.toBeInstanceOf(Fatal);
  });
});
