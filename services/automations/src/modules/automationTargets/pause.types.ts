import type { TargetKey } from "./target.table";

/** A target that is active again and needs an execution job. */
export interface RestoredTarget extends TargetKey {
  /** When the pause that parked it began; part of the resume job id. */
  pausedTime: Date | null;
}

export interface RestoreBatch {
  restored: RestoredTarget[];
  /** Id of the last skipped_actions row read; the next page starts after it. */
  lastId: number;
}

/**
 * Pause lifecycle persistence. Every method is one transaction that first
 * locks the automation row, so a pause flip can never interleave with a batch
 * that moves targets in the opposite direction.
 */
export interface PauseStore {
  /** Pauses an active automation and all its targets. Null when it was not active. */
  pauseAutomation(automationId: number, now: Date): Promise<Date | null>;
  /** Clears the pause flag. Returns when the pause began, or null if it was not paused. */
  resumeAutomation(automationId: number): Promise<Date | null>;
  /** Pauses the automation for good and stamps it for deletion. False if already scheduled. */
  markForDeletion(automationId: number, now: Date): Promise<boolean>;
  /** Moves up to `limit` paused targets into skipped_actions. Null if no longer paused. */
  sweepPausedTargets(automationId: number, limit: number, now: Date): Promise<number | null>;
  /** Restores skipped rows with id > afterId. Null if the automation is paused (again) or gone. */
  restoreSkipped(automationId: number, afterId: number, limit: number, now: Date): Promise<RestoreBatch | null>;
  /** Un-pauses targets that were never swept. Null if the automation is paused (again) or gone. */
  restorePausedInPlace(automationId: number, limit: number, now: Date): Promise<RestoredTarget[] | null>;
  /**
   * Deletes up to `limit` targets and skipped rows of an automation scheduled
   * for deletion; once none remain, deletes its steps and the rule itself.
   */
  purgeDeleted(automationId: number, limit: number): Promise<{ finished: boolean }>;
}
