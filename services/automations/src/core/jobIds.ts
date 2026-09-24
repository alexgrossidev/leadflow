/**
 * Every job this service enqueues carries a deterministic id built from its
 * natural key. BullMQ ignores an add whose id is still stored, so a retried
 * producer cannot double-schedule, while each distinct stage gets its own id.
 * (`:` is normalised to `_` by the shared queue provider.)
 */
type TargetKey = { automationId: number; type: "lead" | "customer"; originalId: number };

const target = (k: TargetKey) => `${k.automationId}:${k.type}:${k.originalId}`;

export const jobIds = {
  /** First execution after a lead is enrolled. */
  enrol: (k: TargetKey) => `exec:${target(k)}:enrol`,
  /** Execution of step `sequence`, due at `dueAt`. */
  step: (k: TargetKey, sequence: number, dueAt: Date) =>
    `exec:${target(k)}:s${sequence}:${dueAt.getTime()}`,
  /** First execution after being restored from a pause that began at `pausedAt`. */
  resume: (k: TargetKey, pausedAt: Date | null) =>
    `exec:${target(k)}:resume:${pausedAt?.getTime() ?? 0}`,
  /** Hand-off of one step to the sender; one per (target, step). */
  deliver: (k: TargetKey, stepId: number) => `deliver:${target(k)}:${stepId}`,
  pauseSweep: (automationId: number, pausedAt: Date) =>
    `cleanup:pause:${automationId}:${pausedAt.getTime()}`,
  purge: (automationId: number) => `cleanup:delete:${automationId}`,
  unpause: (automationId: number, pausedAt: Date) =>
    `unpause:${automationId}:${pausedAt.getTime()}`,
};
