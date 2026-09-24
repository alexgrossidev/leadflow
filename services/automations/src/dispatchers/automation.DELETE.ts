import { logger, type automationDeletedPayload } from "@leadflow/shared";
import { CLEANER_CODES, JobNames } from "@leadflow/shared/jobs";
import { DELETE_GRACE_MS } from "../config/constants";
import { jobIds } from "../core/jobIds";
import type { Enqueuer } from "../core/queue";
import type { PauseStore } from "../modules/automationTargets/pause.types";

/**
 * Deletion is soft first: the automation stops immediately (paused and
 * stamped), and a purge job removes its rows after a grace period during
 * which in-flight jobs see the stamp and stand down.
 */
export function createDeleteHandler(deps: {
  store: Pick<PauseStore, "markForDeletion">;
  queue: Enqueuer;
  clock?: () => Date;
}) {
  const clock = deps.clock ?? (() => new Date());

  return async function AUTOMATION_DELETE(data: automationDeletedPayload): Promise<void> {
    const { automationId } = data;
    const marked = await deps.store.markForDeletion(automationId, clock());
    if (!marked) {
      logger.info({ automationId }, "Automation unknown or already scheduled for deletion");
      return;
    }
    await deps.queue.enqueue(
      JobNames.CLEANUP,
      { id: automationId, executionType: CLEANER_CODES.DELETE },
      { delay: DELETE_GRACE_MS, jobId: jobIds.purge(automationId) },
    );
    logger.info({ automationId }, "Automation scheduled for deletion");
  };
}
