import { describe, expect, it } from "vitest";
import {
  calculateExpectedRuntime,
  parseDelayUnit,
  toRestoredTarget,
  toSkippedTarget,
} from "../target.schedule";
import type { Target } from "../target.table";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-03-10T10:00:00.000Z");

describe("calculateExpectedRuntime", () => {
  it.each([
    ["minute", 30, "2026-03-10T10:30:00.000Z"],
    ["minutes", 30, "2026-03-10T10:30:00.000Z"],
    ["hour", 2, "2026-03-10T12:00:00.000Z"],
    ["Hours", 2, "2026-03-10T12:00:00.000Z"],
    ["day", 1, "2026-03-11T10:00:00.000Z"],
    ["week", 1, "2026-03-17T10:00:00.000Z"],
  ])("adds a delay in %s", (unit, delay, expected) => {
    expect(calculateExpectedRuntime({ from: NOW, delay, delayUnit: unit }, NOW).toISOString()).toBe(expected);
  });

  it("treats a zero or missing delay as immediate, regardless of unit", () => {
    expect(calculateExpectedRuntime({ from: NOW, delay: 0, delayUnit: "fortnight" }, NOW)).toEqual(NOW);
    expect(calculateExpectedRuntime({ from: NOW }, NOW)).toEqual(NOW);
  });

  it("rejects an unknown unit when there is a delay", () => {
    expect(() => calculateExpectedRuntime({ from: NOW, delay: 1, delayUnit: "fortnight" }, NOW)).toThrow(
      /Unknown delay unit/,
    );
  });

  it("pushes the run back by the time spent paused", () => {
    const result = calculateExpectedRuntime(
      {
        from: at("2026-03-10T11:00:00.000Z"),
        pausedAt: at("2026-03-10T09:00:00.000Z"),
        resumedAt: at("2026-03-10T09:45:00.000Z"),
      },
      NOW,
    );
    expect(result.toISOString()).toBe("2026-03-10T11:45:00.000Z");
  });

  it("ignores a pause that ends before it starts", () => {
    const result = calculateExpectedRuntime(
      { from: at("2026-03-10T11:00:00.000Z"), pausedAt: NOW, resumedAt: at("2026-03-10T09:00:00.000Z") },
      NOW,
    );
    expect(result.toISOString()).toBe("2026-03-10T11:00:00.000Z");
  });

  it("clamps overdue work to now instead of scheduling it in the past", () => {
    const result = calculateExpectedRuntime(
      { from: at("2026-03-01T00:00:00.000Z"), delay: 1, delayUnit: "hour" },
      NOW,
    );
    expect(result).toEqual(NOW);
  });
});

describe("parseDelayUnit", () => {
  it.each([
    ["minute", "minute"],
    ["WEEKS", "week"],
    [" day ", "day"],
    ["month", null],
  ])("%s -> %s", (raw, expected) => {
    expect(parseDelayUnit(raw)).toBe(expected);
  });
});

describe("pause snapshots", () => {
  const target: Target = {
    automationId: 7,
    type: "lead",
    originalId: 42,
    userId: 3,
    businessId: 1,
    step: 2,
    stepId: 12,
    paused: true,
    pausedTime: at("2026-03-10T08:00:00.000Z"),
    enrolledAt: at("2026-03-09T08:00:00.000Z"),
    lastExecutionTime: at("2026-03-09T09:00:00.000Z"),
    expectedExecutionTime: at("2026-03-10T09:00:00.000Z"),
  };

  it("round-trips a target through skipped_actions, shifting its due time by the pause", () => {
    const skipped = toSkippedTarget(target, "PAUSE", at("2026-03-10T08:01:00.000Z"));
    const restored = toRestoredTarget({ id: 1, ...skipped }, NOW);

    expect(restored).toMatchObject({
      automationId: 7,
      type: "lead",
      originalId: 42,
      userId: 3,
      businessId: 1,
      step: 2,
      stepId: 12,
      paused: false,
      pausedTime: null,
      lastExecutionTime: target.lastExecutionTime,
    });
    // Due 1h after the pause began; paused for 2h -> due 1h after the resume.
    expect(restored.expectedExecutionTime?.toISOString()).toBe("2026-03-10T11:00:00.000Z");
  });

  it("leaves the due time unset for a target that never ran", () => {
    expect(toRestoredTarget({ ...target, expectedExecutionTime: null }, NOW).expectedExecutionTime).toBeNull();
  });
});
