import type { QueueWorker } from "@leadflow/shared/queue";
import {
  startFacebookLeadWorker,
  startGoogleLeadWorker,
} from "./LeadCollection/lead.workers";
import {
  startTokenExchangeWorker,
  startTokenRefreshWorker,
} from "./Tokenisation/token.workers";
import { startSubscriptionWorker } from "./Sync/subscription.worker";
import { startSyncWorker } from "./Sync/sync.worker";
import { startRecoverySweep } from "./Recovery/recovery.worker";

export interface RunningWorkers {
  /** Stop taking jobs, let in-flight ones finish, and stop the recovery sweep. */
  stop(): Promise<void>;
}

export function startWorkers(): RunningWorkers {
  const workers: QueueWorker[] = [
    startFacebookLeadWorker(),
    startGoogleLeadWorker(),
    startTokenExchangeWorker(),
    startTokenRefreshWorker(),
    startSubscriptionWorker(),
    startSyncWorker(),
  ];
  const stopSweep = startRecoverySweep();

  return {
    async stop() {
      await stopSweep();
      await Promise.all(workers.map((w) => w.close()));
    },
  };
}
