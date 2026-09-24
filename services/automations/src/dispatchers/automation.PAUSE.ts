import { logger, type automationPausedPayload } from "@leadflow/shared";
import { CLEANER_CODES, JobNames } from "@leadflow/shared/jobs";
import { PAUSE_SWEEP_DELAY_MS } from "../config/constants";
import { jobIds } from "../core/jobIds";
import type { Enqueuer } from "../core/queue";
import type { PauseStore } from "../modules/automationTargets/pause.types";

export interface PauseDeps {
  store: Pick<PauseStore, "pauseAutomation" | "resumeAutomation">;
  queue: Enqueuer;
  clock?: () => Date;
}

/**
 * Pausing flips the automation and its targets in one transaction, then
 * schedules a sweep that parks paused targets in skipped_actions. Resuming
 * clears the flag and schedules the restore. Both job ids embed the pause's
 * start time, so every pause/resume cycle gets its own jobs while a
 * redelivered event is deduplicated.
 */
export function createPauseHandler(deps: PauseDeps) {
  const clock = deps.clock ?? (() => new Date());

  return async function AUTOMATION_PAUSE(data: automationPausedPayload): Promise<void> {
    const { automationId, userId, paused } = data;

    if (paused) {
      const pausedAt = await deps.store.pauseAutomation(automationId, clock());
      if (!pausedAt) {
        logger.info({ automationId }, "Automation already paused or not active; nothing to do");
        return;
      }
      await deps.queue.enqueue(
        JobNames.CLEANUP,
        { id: automationId, executionType: CLEANER_CODES.BULK_CLEANUP },
        { delay: PAUSE_SWEEP_DELAY_MS, jobId: jobIds.pauseSweep(automationId, pausedAt) },
      );
      logger.info({ automationId }, "Automation paused; sweep scheduled");
      return;
    }

    const pausedAt = await deps.store.resumeAutomation(automationId);
    if (!pausedAt) {
      logger.info({ automationId }, "Automation not paused; nothing to resume");
      return;
    }
    await deps.queue.enqueue(
      JobNames.AUTOMATION_UNPAUSE,
      { id: automationId, executionType: CLEANER_CODES.BULK_CLEANUP, lastId: 0, userId },
      { jobId: jobIds.unpause(automationId, pausedAt) },
    );
    logger.info({ automationId }, "Automation resumed; restore scheduled");
  };
}
