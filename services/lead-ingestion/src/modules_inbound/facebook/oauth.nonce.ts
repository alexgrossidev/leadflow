import { getClient } from "@leadflow/shared/redis";

/** Burns OAuth state nonces so a captured callback URL cannot be replayed. */
export interface NonceStore {
  /** True the first time `nonce` is seen within `ttlMs`; false on a replay. */
  consume(nonce: string, ttlMs: number): Promise<boolean>;
}

/** `SET NX PX` records-if-absent atomically; expiry matches the state's own TTL. */
export const redisNonceStore: NonceStore = {
  async consume(nonce, ttlMs) {
    const res = await getClient().set(`fb:oauth:nonce:${nonce}`, "1", {
      NX: true,
      PX: ttlMs,
    });
    return res === "OK";
  },
};
