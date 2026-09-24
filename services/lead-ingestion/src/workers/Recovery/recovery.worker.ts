import { logger } from "#core/logger";
import { queueRecoveryClient } from "../../modules_inbound/failed/failed.module";

// Re-drive interval for dead-lettered jobs. runSweep is claim-guarded and
// replay-safe, so running it on every replica is harmless.
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Starts the periodic recovery sweep and returns a stop function that waits for
 * an in-flight sweep, so shutdown never closes the DB pool under it.
 */
export function startRecoverySweep(): () => Promise<void> {
  let running: Promise<void> | null = null;

  const sweep = () => {
    if (running) return; // never let two sweeps overlap
    running = queueRecoveryClient
      .runSweep()
      .then(() => undefined)
      .catch((err) => logger.error({ err }, "Queue recovery sweep failed"))
      .finally(() => {
        running = null;
      });
  };

  // unref so the timer alone never holds the process open.
  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref();

  return async () => {
    clearInterval(timer);
    await running;
  };
}
