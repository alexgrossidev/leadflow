import { randomUUID } from "node:crypto";
import { logger } from "../logger/logger";
import { getClient, type RedisClient } from "./client";

// ─── Redis Distributed Lock ────────────────────────────────────────────────
// Ensures only ONE process across all replicas runs the guarded callback.
// Uses SET NX EX (atomic acquire) + Lua EVAL (atomic compare-and-delete release),
// so a holder whose lock expired can never delete a lock someone else now owns.

const RELEASE_LUA = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

export interface AcquireLockOptions {
  /** Lock key name in Redis */
  key: string;
  /** Lock TTL in seconds (auto-expires if the holder crashes). Default 60. */
  ttlSeconds?: number;
}

/**
 * Try to acquire a distributed lock.
 * Returns a release function if acquired, or null if another instance holds it.
 * The release resolves to `false` when the lock had already expired (and may
 * have been taken by another holder) — i.e. the critical section overran its TTL.
 */
export async function tryAcquireLock(
  opts: AcquireLockOptions,
  client: Pick<RedisClient, "set" | "eval"> = getClient(),
): Promise<(() => Promise<boolean>) | null> {
  const token = randomUUID();
  const ttl = opts.ttlSeconds ?? 60;

  const acquired = await client.set(opts.key, token, { NX: true, EX: ttl });
  if (!acquired) {
    logger.debug({ key: opts.key }, "Lock already held by another instance");
    return null;
  }

  return async () => {
    const deleted = await client.eval(RELEASE_LUA, {
      keys: [opts.key],
      arguments: [token],
    });
    if (deleted === 1) return true;
    logger.warn({ key: opts.key, ttl }, "Lock expired before release; critical section overran its TTL");
    return false;
  };
}

/**
 * Run a callback only if this instance acquires the lock; returns null otherwise.
 * A failing release is logged but never masks the callback's own result or error.
 */
export async function withLeaderLock<T>(
  opts: AcquireLockOptions,
  fn: () => Promise<T>,
  client?: Pick<RedisClient, "set" | "eval">,
): Promise<T | null> {
  const release = await tryAcquireLock(opts, client);
  if (!release) return null;

  try {
    return await fn();
  } finally {
    await release().catch((err: unknown) =>
      logger.error({ err, key: opts.key }, "Lock release failed"),
    );
  }
}
