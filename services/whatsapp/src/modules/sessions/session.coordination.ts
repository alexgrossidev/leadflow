import { getClient, tryAcquireLock, type RedisClient } from "@leadflow/shared/redis";
import { UnrecoverableWhatsappError } from "#transport/whatsapp.errors";

export type ReleaseLock = () => Promise<boolean>;

/**
 * Cross-replica session state that must not live in process memory: locks,
 * last-activity markers, QR failure counters and QR refresh cooldowns.
 * Everything here is ephemeral and carries a TTL; the database row stays the
 * source of truth for the session lifecycle.
 */
export interface SessionCoordinator {
  /** Per-session lock around init, so two replicas never start the same session. */
  acquireInitLock(businessId: number, userId: number, ttlSeconds: number): Promise<ReleaseLock | null>;
  /** Global lock around "count active sessions, then claim a slot", so the cap cannot be overshot. */
  withCapacityLock<T>(fn: () => Promise<T>): Promise<T>;
  /** Mark the session active for the next `ttlMs`. */
  recordActivity(businessId: number, userId: number, ttlMs: number): Promise<void>;
  /** Milliseconds until the activity marker expires (0 when it already has). */
  activityRemainingMs(businessId: number, userId: number): Promise<number>;
  incrementQrFailures(businessId: number, userId: number, windowSeconds: number): Promise<number>;
  resetQrFailures(businessId: number, userId: number): Promise<void>;
  /** True for the first caller in each cooldown window; false while it is running. */
  claimQrRefresh(businessId: number, userId: number, cooldownMs: number): Promise<boolean>;
}

type CoordinatorRedis = Pick<RedisClient, "set" | "eval" | "pTTL" | "incr" | "expire" | "del">;

const CAPACITY_LOCK_KEY = "whatsapp:sessions:capacity-lock";
const CAPACITY_LOCK_TTL_SECONDS = 10;
const CAPACITY_LOCK_ATTEMPTS = 20;
const CAPACITY_LOCK_RETRY_MS = 50;

const key = (businessId: number, userId: number, suffix: string) =>
  `whatsapp:session:${businessId}:${userId}:${suffix}`;

export class RedisSessionCoordinator implements SessionCoordinator {
  /** The client is resolved lazily so constructing the service never opens a connection. */
  constructor(private readonly redis: () => CoordinatorRedis = getClient) {}

  acquireInitLock(businessId: number, userId: number, ttlSeconds: number): Promise<ReleaseLock | null> {
    return tryAcquireLock({ key: key(businessId, userId, "init-lock"), ttlSeconds }, this.redis());
  }

  async withCapacityLock<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < CAPACITY_LOCK_ATTEMPTS; attempt++) {
      const release = await tryAcquireLock(
        { key: CAPACITY_LOCK_KEY, ttlSeconds: CAPACITY_LOCK_TTL_SECONDS },
        this.redis(),
      );
      if (release) {
        try {
          return await fn();
        } finally {
          await release();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, CAPACITY_LOCK_RETRY_MS));
    }
    throw new UnrecoverableWhatsappError("Session capacity check is busy, retry shortly", "SESSION_INIT_BUSY");
  }

  async recordActivity(businessId: number, userId: number, ttlMs: number): Promise<void> {
    await this.redis().set(key(businessId, userId, "activity"), Date.now().toString(), { PX: ttlMs });
  }

  async activityRemainingMs(businessId: number, userId: number): Promise<number> {
    const ttl = await this.redis().pTTL(key(businessId, userId, "activity"));
    return Math.max(0, Number(ttl));
  }

  async incrementQrFailures(businessId: number, userId: number, windowSeconds: number): Promise<number> {
    const counterKey = key(businessId, userId, "qr-failures");
    const failures = await this.redis().incr(counterKey);
    await this.redis().expire(counterKey, windowSeconds);
    return Number(failures);
  }

  async resetQrFailures(businessId: number, userId: number): Promise<void> {
    await this.redis().del(key(businessId, userId, "qr-failures"));
  }

  async claimQrRefresh(businessId: number, userId: number, cooldownMs: number): Promise<boolean> {
    const claimed = await this.redis().set(key(businessId, userId, "qr-refresh"), "1", { NX: true, PX: cooldownMs });
    return claimed !== null;
  }
}
