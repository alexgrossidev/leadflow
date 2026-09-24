import { logger, type JobContext } from "@leadflow/shared";
import { JobNames, type AutomationUnpausePayload } from "@leadflow/shared/jobs";
import { CLEANUP_BATCH_SIZE } from "../config/constants";
import { jobIds } from "../core/jobIds";
import type { Enqueuer } from "../core/queue";
import type { PauseStore, RestoredTarget } from "../modules/automationTargets/pause.types";

export interface UnpauseDeps {
  store: Pick<PauseStore, "restoreSkipped" | "restorePausedInPlace">;
  queue: Enqueuer;
  batchSize?: number;
  clock?: () => Date;
}

/**
 * Restores a resumed automation's targets: pages through skipped_actions by
 * keyset (the id of the last row restored, starting from the payload's
 * `lastId`), then un-pauses any target the sweep never reached. Each batch is
 * one transaction; each restored target gets an execution job whose id is
 * scoped to the pause it came back from, so a retried job re-enqueues nothing.
 */
export function createUnpauseHandler(deps: UnpauseDeps) {
  const batchSize = deps.batchSize ?? CLEANUP_BATCH_SIZE;
  const clock = deps.clock ?? (() => new Date());

  const relaunch = (restored: RestoredTarget[], userId: number) =>
    Promise.all(
      restored.map((target) =>
        deps.queue.enqueue(
          JobNames.AUTOMATION_EXECUTE_INTERNAL,
          {
            automationId: target.automationId,
            userId,
            leadId: target.originalId,
            type: target.type,
            executionType: "launch",
          },
          { jobId: jobIds.resume(target, target.pausedTime) },
        ),
      ),
    );

  return async function AUTOMATION_UNPAUSE(job: JobContext<AutomationUnpausePayload>): Promise<void> {
    const { id: automationId, userId } = job.data;
    let cursor = job.data.lastId;
    let total = 0;

    for (;;) {
      const page = await deps.store.restoreSkipped(automationId, cursor, batchSize, clock());
      if (page === null) {
        logger.info({ automationId, restored: total }, "Automation paused again or removed; restore stopped");
        return;
      }
      await relaunch(page.restored, userId);
      total += page.restored.length;
      cursor = page.lastId;
      if (page.restored.length < batchSize) break;
    }

    // Targets paused but never swept (the sweep had not run yet, or a
    // straggler was flagged after it ran) are restored where they are.
    for (;;) {
      const restored = await deps.store.restorePausedInPlace(automationId, batchSize, clock());
      if (!restored) break;
      await relaunch(restored, userId);
      total += restored.length;
      if (restored.length < batchSize) break;
    }
    logger.info({ automationId, restored: total }, "Automation targets restored");
  };
}
