import { getClient } from "@leadflow/shared/redis";

/** Caps how many submissions a single source may make within a window. */
export interface RateLimiter {
  /** True if this hit is within the cap; false once the source exceeds `limit`. */
  allow(key: string, limit: number, windowMs: number): Promise<boolean>;
}

/** Minimal Redis surface the limiter needs — keeps it unit-testable with a fake. */
interface IncrClient {
  incr(key: string): Promise<number>;
  pExpire(key: string, ms: number): Promise<unknown>;
  pTTL(key: string): Promise<number>;
}

/**
 * Fixed-window counter: INCR the source key, set the window TTL on the first hit,
 * allow while the count stays within `limit`.
 *
 * Trade-off: a fixed window (not sliding) can briefly admit up to 2x the limit
 * for a burst straddling the window boundary. That is acceptable for a flood
 * cap; a sorted-set sliding window is the upgrade if it ever matters.
 */
export function makeRedisRateLimiter(
  resolveClient: () => Promise<IncrClient>,
): RateLimiter {
  return {
    async allow(key, limit, windowMs) {
      const client = await resolveClient();
      const redisKey = `gforms:rate:${key}`;
      const count = await client.incr(redisKey);
      if (count === 1) {
        await client.pExpire(redisKey, windowMs);
      } else if (count > limit && (await client.pTTL(redisKey)) < 0) {
        // INCR and PEXPIRE are two commands: if a crash landed between them the
        // counter has no TTL and would block this source forever. Heal it here,
        // on the rare over-limit path, instead of paying a round-trip per hit.
        await client.pExpire(redisKey, windowMs);
      }
      return count <= limit;
    },
  };
}

/** Production limiter over the shared (lazily connected) Redis client. */
export const redisRateLimiter = makeRedisRateLimiter(async () => getClient());
