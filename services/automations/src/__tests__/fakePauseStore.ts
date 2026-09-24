import { SKIP_REASONS } from "../config/constants";
import type { PauseStore, RestoreBatch, RestoredTarget } from "../modules/automationTargets/pause.types";
import { toRestoredTarget, toSkippedTarget } from "../modules/automationTargets/target.schedule";
import type { NewTarget, Target } from "../modules/automationTargets/target.table";
import type { SkippedTarget } from "../modules/skipped/skipped.table";

interface AutomationState {
  paused: boolean;
  pausedAt: Date | null;
  scheduledDeletionAt: Date | null;
}

const keyOf = (t: Pick<Target, "automationId" | "type" | "originalId">) =>
  `${t.automationId}:${t.type}:${t.originalId}`;

const asRow = (t: NewTarget): Target => ({
  automationId: t.automationId,
  type: t.type,
  originalId: t.originalId,
  userId: t.userId,
  businessId: t.businessId,
  step: t.step ?? null,
  stepId: t.stepId ?? null,
  paused: t.paused ?? false,
  pausedTime: t.pausedTime ?? null,
  enrolledAt: t.enrolledAt ?? new Date(0),
  lastExecutionTime: t.lastExecutionTime ?? null,
  expectedExecutionTime: t.expectedExecutionTime ?? null,
});

/**
 * In-memory PauseStore with the same contract as the Drizzle repository:
 * every method checks the automation state first, then moves rows.
 */
export class FakePauseStore implements PauseStore {
  readonly automations = new Map<number, AutomationState>();
  readonly targets = new Map<string, Target>();
  readonly skipped: SkippedTarget[] = [];
  private nextSkipId = 1;

  addAutomation(id: number) {
    this.automations.set(id, { paused: false, pausedAt: null, scheduledDeletionAt: null });
  }

  addTarget(target: NewTarget) {
    this.targets.set(keyOf(target), asRow(target));
  }

  targetsOf(automationId: number) {
    return [...this.targets.values()].filter((t) => t.automationId === automationId);
  }

  async pauseAutomation(id: number, now: Date) {
    const a = this.automations.get(id);
    if (!a || a.paused || a.scheduledDeletionAt) return null;
    Object.assign(a, { paused: true, pausedAt: now });
    for (const t of this.targetsOf(id)) if (!t.paused) Object.assign(t, { paused: true, pausedTime: now });
    return now;
  }

  async resumeAutomation(id: number) {
    const a = this.automations.get(id);
    if (!a || !a.paused || a.scheduledDeletionAt) return null;
    const pausedAt = a.pausedAt ?? new Date(0);
    Object.assign(a, { paused: false, pausedAt: null });
    return pausedAt;
  }

  async markForDeletion(id: number, now: Date) {
    const a = this.automations.get(id);
    if (!a || a.scheduledDeletionAt) return false;
    Object.assign(a, { paused: true, pausedAt: a.pausedAt ?? now, scheduledDeletionAt: now });
    return true;
  }

  async sweepPausedTargets(id: number, limit: number, now: Date) {
    if (!this.automations.get(id)?.paused) return null;
    const batch = this.targetsOf(id).filter((t) => t.paused).slice(0, limit);
    for (const t of batch) {
      this.skipped.push({ id: this.nextSkipId++, ...toSkippedTarget(t, SKIP_REASONS.PAUSE, now) });
      this.targets.delete(keyOf(t));
    }
    return batch.length;
  }

  async restoreSkipped(id: number, afterId: number, limit: number, now: Date): Promise<RestoreBatch | null> {
    const a = this.automations.get(id);
    if (!a || a.paused || a.scheduledDeletionAt) return null;
    const page = this.skipped
      .filter((s) => s.automationId === id && s.id > afterId)
      .sort((x, y) => x.id - y.id)
      .slice(0, limit);
    for (const s of page) {
      this.addTarget(toRestoredTarget(s, now));
      this.skipped.splice(this.skipped.indexOf(s), 1);
    }
    return {
      restored: page.map((s) => ({ automationId: s.automationId, type: s.type, originalId: s.originalId, pausedTime: s.pausedTime })),
      lastId: page.at(-1)?.id ?? afterId,
    };
  }

  async restorePausedInPlace(id: number, limit: number, now: Date): Promise<RestoredTarget[] | null> {
    const a = this.automations.get(id);
    if (!a || a.paused || a.scheduledDeletionAt) return null;
    const batch = this.targetsOf(id).filter((t) => t.paused).slice(0, limit);
    for (const t of batch) this.addTarget(toRestoredTarget(t, now));
    return batch.map((t) => ({ automationId: t.automationId, type: t.type, originalId: t.originalId, pausedTime: t.pausedTime }));
  }

  async purgeDeleted(id: number, limit: number) {
    const a = this.automations.get(id);
    if (!a) return { finished: true };
    const doomed = this.targetsOf(id).slice(0, limit);
    doomed.forEach((t) => this.targets.delete(keyOf(t)));
    const skips = this.skipped.filter((s) => s.automationId === id).slice(0, limit);
    skips.forEach((s) => this.skipped.splice(this.skipped.indexOf(s), 1));
    if (doomed.length >= limit || skips.length >= limit) return { finished: false };
    this.automations.delete(id);
    return { finished: true };
  }
}
