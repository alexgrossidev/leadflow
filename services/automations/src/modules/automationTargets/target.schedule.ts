import type { SkipReason } from "../../config/constants";
import type { SkippedTarget } from "../skipped/skipped.table";
import type { NewTarget, Target } from "./target.table";

export const DELAY_UNIT_MS = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
} as const;

export type DelayUnit = keyof typeof DELAY_UNIT_MS;

/** Accepts singular or plural spellings ("hour", "Hours"). */
export function parseDelayUnit(raw: string): DelayUnit | null {
  const key = raw.trim().toLowerCase().replace(/s$/, "");
  return key in DELAY_UNIT_MS ? (key as DelayUnit) : null;
}

export interface RuntimeInput {
  /** When the delay starts counting: enrolment, the previous hand-off, or the stored due time. */
  from: Date;
  delay?: number | null;
  delayUnit?: string | null;
  /** A pause between `pausedAt` and `resumedAt` pushes the run back by its length. */
  pausedAt?: Date | null;
  resumedAt?: Date | null;
}

/**
 * When a target's step should run: `from + delay + time spent paused`,
 * clamped to `now` so work that is already overdue runs immediately instead
 * of being scheduled in the past.
 */
export function calculateExpectedRuntime(input: RuntimeInput, now: Date): Date {
  let delayMs = 0;
  if (input.delay) {
    const unit = parseDelayUnit(input.delayUnit ?? "");
    if (!unit) throw new Error(`Unknown delay unit: ${String(input.delayUnit)}`);
    delayMs = input.delay * DELAY_UNIT_MS[unit];
  }

  let pauseMs = 0;
  if (input.pausedAt && input.resumedAt) {
    pauseMs = Math.max(0, input.resumedAt.getTime() - input.pausedAt.getTime());
  }

  const expected = input.from.getTime() + delayMs + pauseMs;
  return new Date(Math.max(expected, now.getTime()));
}

/** Snapshot of a paused target, parked in skipped_actions. */
export function toSkippedTarget(target: Target, reason: SkipReason, now: Date): Omit<SkippedTarget, "id"> {
  return {
    automationId: target.automationId,
    type: target.type,
    originalId: target.originalId,
    userId: target.userId,
    businessId: target.businessId,
    step: target.step,
    stepId: target.stepId,
    pausedTime: target.pausedTime ?? now,
    enrolledAt: target.enrolledAt,
    lastExecutionTime: target.lastExecutionTime,
    expectedExecutionTime: target.expectedExecutionTime,
    reasonCode: reason,
    skippedAt: now,
  };
}

/**
 * Brings a parked (or paused in place) target back. Its due time moves forward
 * by the length of the pause, so a step that was 2h away when paused is still
 * 2h away when resumed. A target without a due time yet (enrolled but never
 * executed) gets one computed from its enrolment on its next execution.
 */
export function toRestoredTarget(snapshot: Target | SkippedTarget, now: Date): NewTarget {
  return {
    automationId: snapshot.automationId,
    type: snapshot.type,
    originalId: snapshot.originalId,
    userId: snapshot.userId,
    businessId: snapshot.businessId,
    step: snapshot.step,
    stepId: snapshot.stepId,
    paused: false,
    pausedTime: null,
    enrolledAt: snapshot.enrolledAt,
    lastExecutionTime: snapshot.lastExecutionTime,
    expectedExecutionTime: snapshot.expectedExecutionTime
      ? calculateExpectedRuntime(
          { from: snapshot.expectedExecutionTime, pausedAt: snapshot.pausedTime, resumedAt: now },
          now,
        )
      : null,
  };
}
