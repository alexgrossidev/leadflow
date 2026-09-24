import { logger, type JobContext } from "@leadflow/shared";
import { CLEANER_CODES, type CleanupPayload } from "@leadflow/shared/jobs";
import { CLEANUP_BATCH_SIZE } from "../config/constants";
import type { PauseStore } from "../modules/automationTargets/pause.types";

export interface CleanupDeps {
  store: Pick<PauseStore, "sweepPausedTargets" | "purgeDeleted">;
  batchSize?: number;
  clock?: () => Date;
}

/**
 * Works through an automation in batches, each its own short transaction, so
 * a large automation never holds row locks for long. Routing is on the
 * payload's `executionType`, not the job name. Errors propagate so the queue
 * retries; a retry resumes where the last committed batch left off.
 */
export function createCleanupHandler(deps: CleanupDeps) {
  const batchSize = deps.batchSize ?? CLEANUP_BATCH_SIZE;
  const clock = deps.clock ?? (() => new Date());

  const sweep = async (automationId: number) => {
    let total = 0;
    for (;;) {
      const moved = await deps.store.sweepPausedTargets(automationId, batchSize, clock());
      if (moved === null) {
        logger.info({ automationId, moved: total }, "Automation no longer paused; sweep stopped");
        return;
      }
      total += moved;
      if (moved < batchSize) break;
    }
    logger.info({ automationId, moved: total }, "Paused targets moved to skipped_actions");
  };

  const purge = async (automationId: number) => {
    let finished = false;
    while (!finished) ({ finished } = await deps.store.purgeDeleted(automationId, batchSize));
    logger.info({ automationId }, "Automation purged");
  };

  return async function CLEANUP(job: JobContext<CleanupPayload>): Promise<void> {
    const { id: automationId, executionType } = job.data;
    switch (executionType) {
      // Both codes mean "sweep paused targets"; the shared enum keeps FAST for older producers.
      case CLEANER_CODES.BULK_CLEANUP:
      case CLEANER_CODES.FAST_CLEANUP:
        return sweep(automationId);
      case CLEANER_CODES.DELETE:
        return purge(automationId);
    }
  };
}
