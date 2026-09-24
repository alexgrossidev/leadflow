import { describe, expect, it, vi } from "vitest";
import { FakeStagingStore, FakeStatusStore } from "../test/fakes.js";
import { silentLogger } from "../test/silentLogger.js";
import { deliverImport } from "./deliverImport.js";

const JOB = "00000000-0000-0000-0000-000000000006";
const limits = { maxReschedules: 5, maxStagingWaitMs: 60_000, baseDelayMs: 1_000, jitterMs: 500 };

function setup(clock = { now: 1_000_000 }) {
  const status = new FakeStatusStore(() => clock.now);
  const staging = new FakeStagingStore();
  const report = vi.fn(async () => {});
  const reschedule = vi.fn(async () => {});
  const deliver = vi.fn(async () => {});
  const run = () =>
    deliverImport(
      {
        staging,
        status,
        report,
        deliver,
        reschedule,
        log: silentLogger,
        limits,
        now: () => clock.now,
        random: () => 0.5,
      },
      {
        payload: { sessionId: JOB, businessId: 1, userId: 1, type: "customer" },
        isFinalAttempt: false,
      },
    );
  return { clock, status, staging, report, reschedule, deliver, run };
}

describe("deliverImport while staging is still running", () => {
  it("reschedules itself with a bounded, jittered delay", async () => {
    const { status, reschedule, deliver, run } = setup();
    await status.set(JOB, "progress");

    await expect(run()).resolves.toEqual({ kind: "rescheduled", delayMs: 1_250 });
    expect(reschedule).toHaveBeenCalledWith(1_250, 1);
    expect(status.rows.get(JOB)?.rescheduleCount).toBe(1);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("stops after maxReschedules and fails the import with a clear reason", async () => {
    const { clock, status, report, reschedule, run } = setup();
    await status.set(JOB, "progress");

    // Simulates staging that died without writing FAIL: the loop must end.
    const outcomes: string[] = [];
    for (let i = 0; i < 100; i++) {
      clock.now += 1_000;
      const outcome = await run();
      outcomes.push(outcome.kind);
      if (outcome.kind !== "rescheduled") break;
    }

    expect(outcomes).toEqual([...Array(limits.maxReschedules).fill("rescheduled"), "staging-timeout"]);
    expect(reschedule).toHaveBeenCalledTimes(limits.maxReschedules);
    expect(status.rows.get(JOB)).toMatchObject({
      status: "fail",
      failReason: expect.stringContaining("Staging did not finish"),
    });
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: expect.stringContaining("5 checks") }),
    );
  });

  it("fails once the maximum wait has elapsed, even under the reschedule cap", async () => {
    const { clock, status, reschedule, run } = setup();
    await status.set(JOB, "pending");
    clock.now += limits.maxStagingWaitMs;

    await expect(run()).resolves.toMatchObject({ kind: "staging-timeout" });
    expect(reschedule).not.toHaveBeenCalled();
    expect(status.rows.get(JOB)?.status).toBe("fail");
  });
});

describe("deliverImport terminal states", () => {
  it.each(["fail", "processed"] as const)("does nothing when status is %s", async (current) => {
    const { status, deliver, report, run } = setup();
    await status.set(JOB, current);
    await expect(run()).resolves.toEqual({ kind: "skipped", status: current });
    expect(deliver).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("throws when the import is unknown", async () => {
    const { run } = setup();
    await expect(run()).rejects.toThrow("No import_status row");
  });
});
