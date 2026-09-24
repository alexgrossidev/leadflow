import { beforeEach, describe, expect, it } from "vitest";
import { CLEANER_CODES, JobNames } from "@leadflow/shared/jobs";
import { createPauseHandler } from "../../dispatchers/automation.PAUSE";
import { createDeleteHandler } from "../../dispatchers/automation.DELETE";
import { createCleanupHandler } from "../cleaner.process";
import { createUnpauseHandler } from "../automation.unpause";
import { FakePauseStore } from "../../__tests__/fakePauseStore";
import { ctx, FakeQueue } from "../../__tests__/fakeQueue";

const AUTOMATION = 7;
const T0 = new Date("2026-03-10T09:00:00.000Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("pause / unpause round trip", () => {
  let store: FakePauseStore;
  let queue: FakeQueue;
  let now: Date;
  const clock = () => now;

  const handlers = () => ({
    pause: createPauseHandler({ store, queue, clock }),
    cleanup: createCleanupHandler({ store, clock, batchSize: 2 }),
    unpause: createUnpauseHandler({ store, queue, clock, batchSize: 2 }),
    remove: createDeleteHandler({ store, queue, clock }),
  });

  const runAll = async () => {
    const { cleanup, unpause } = handlers();
    for (let guard = 0; guard < 50; guard++) {
      const cleanups = queue.drain(JobNames.CLEANUP);
      const unpauses = queue.drain(JobNames.AUTOMATION_UNPAUSE);
      if (cleanups.length + unpauses.length === 0) return;
      for (const job of cleanups) await cleanup(ctx(job));
      for (const job of unpauses) await unpause(ctx(job));
    }
    throw new Error("jobs kept re-enqueueing");
  };

  beforeEach(() => {
    store = new FakePauseStore();
    queue = new FakeQueue();
    now = T0;
    store.addAutomation(AUTOMATION);
    for (let lead = 1; lead <= 5; lead++) {
      store.addTarget({
        automationId: AUTOMATION,
        type: "lead",
        originalId: lead,
        userId: 3,
        businessId: 1,
        step: 2,
        stepId: 20,
        enrolledAt: minutes(-120),
        lastExecutionTime: minutes(-60),
        expectedExecutionTime: minutes(60 + lead),
      });
    }
    // A target of another automation must never be touched.
    store.addAutomation(8);
    store.addTarget({ automationId: 8, type: "lead", originalId: 1, userId: 3, businessId: 1 });
  });

  it("parks every target on pause and restores all of them, shifted by the pause, on resume", async () => {
    const { pause } = handlers();

    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: true });
    now = minutes(1);
    await runAll();

    expect(store.targetsOf(AUTOMATION)).toHaveLength(0);
    expect(store.skipped).toHaveLength(5);
    expect(store.targetsOf(8)).toEqual([expect.objectContaining({ paused: false })]);

    now = minutes(30);
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: false });
    await runAll();

    // Paging with batchSize 2 over 5 rows restores all of them (keyset on the last row id).
    const restored = store.targetsOf(AUTOMATION).sort((a, b) => a.originalId - b.originalId);
    expect(restored.map((t) => t.originalId)).toEqual([1, 2, 3, 4, 5]);
    expect(store.skipped).toHaveLength(0);
    for (const t of restored) {
      expect(t.paused).toBe(false);
      expect(t.step).toBe(2);
      // Due at +60+lead minutes; paused for 30 minutes -> 30 minutes later.
      expect(t.expectedExecutionTime).toEqual(minutes(90 + t.originalId));
    }

    const launches = queue.of(JobNames.AUTOMATION_EXECUTE_INTERNAL);
    expect(launches.map((j) => j.data.leadId).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(launches.map((j) => j.id)).size).toBe(5);
  });

  it("restores targets the sweep never reached", async () => {
    const { pause } = handlers();
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: true });
    // Resume before the delayed sweep has run.
    queue.drain(JobNames.CLEANUP);
    now = minutes(10);
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: false });
    await runAll();

    expect(store.targetsOf(AUTOMATION).every((t) => !t.paused)).toBe(true);
    expect(queue.of(JobNames.AUTOMATION_EXECUTE_INTERNAL)).toHaveLength(5);
  });

  it("gives every pause its own sweep job, so a second pause is not deduplicated", async () => {
    const { pause } = handlers();
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: true });
    await runAll();
    now = minutes(5);
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: false });
    await runAll();
    now = minutes(10);
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: true });
    await runAll();

    expect(queue.ignored).toEqual([]);
    expect(store.skipped).toHaveLength(5);
  });

  it("ignores a redelivered pause event", async () => {
    const { pause } = handlers();
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: true });
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: true });
    expect(queue.of(JobNames.CLEANUP)).toHaveLength(1);
  });

  it("stops restoring when the automation is paused again mid-restore", async () => {
    const { pause } = handlers();
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: true });
    await runAll();
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: false });
    await pause({ automationId: AUTOMATION, userId: 3, businessId: 1, paused: true });
    await runAll();

    expect(store.targetsOf(AUTOMATION)).toHaveLength(0);
    expect(store.skipped).toHaveLength(5);
  });

  it("purges a deleted automation in batches, routed by executionType", async () => {
    const { remove } = handlers();
    await remove({ automationId: AUTOMATION, userId: 3, businessId: 1 });

    const [purge] = queue.of(JobNames.CLEANUP);
    expect(purge?.data.executionType).toBe(CLEANER_CODES.DELETE);
    await runAll();

    expect(store.targetsOf(AUTOMATION)).toHaveLength(0);
    expect(store.automations.has(AUTOMATION)).toBe(false);
    expect(store.targetsOf(8)).toHaveLength(1);
  });
});
