import { getClient } from "@leadflow/shared/redis";

/** Thin string cache over the shared Redis client. */
export const cache = {
  async get(key: string): Promise<string | null> {
    return getClient().get(key);
  },

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await getClient().set(key, value, { EX: ttlSeconds });
  },

  async del(key: string): Promise<void> {
    await getClient().del(key);
  },
};
