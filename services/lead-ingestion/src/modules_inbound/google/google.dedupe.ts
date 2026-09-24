import { getClient } from "@leadflow/shared/redis";

/** Records seen submission ids so a replayed responseId can be dropped at the edge. */
export interface SeenStore {
  /** True if `responseId` was already accepted within the replay window. */
  isSeen(responseId: string): Promise<boolean>;
  /** Record `responseId` as accepted for `ttlMs`. */
  markSeen(responseId: string, ttlMs: number): Promise<void>;
}

const key = (responseId: string) => `gforms:seen:${responseId}`;

/** Redis-backed dedupe; keys expire with the replay window. */
export const redisSeenStore: SeenStore = {
  async isSeen(responseId) {
    return (await getClient().exists(key(responseId))) === 1;
  },
  async markSeen(responseId, ttlMs) {
    await getClient().set(key(responseId), "1", { PX: ttlMs });
  },
};
