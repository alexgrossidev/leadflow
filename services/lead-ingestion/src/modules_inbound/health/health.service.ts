import { getClient } from "@leadflow/shared/redis";
import { checkMainConnection } from "#database/pool";
import { databaseKeepAlive } from "#database/keepalive";

/** Dependency probes; injectable so the routes can be tested without infrastructure. */
export interface HealthProbes {
  redis(): Promise<boolean>;
  db(): Promise<boolean>;
}

export const defaultHealthProbes: HealthProbes = {
  async redis() {
    try {
      return getClient().isReady;
    } catch {
      return false;
    }
  },
  async db() {
    // Fast path: the heartbeat already tracks liveness continuously, so an
    // unhealthy verdict is answered without queueing behind a dead pool.
    if (!databaseKeepAlive.healthy) return false;
    return checkMainConnection();
  },
};
