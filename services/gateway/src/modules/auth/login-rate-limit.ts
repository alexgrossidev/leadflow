import { getClient } from "@leadflow/shared/redis";
import { logger } from "#core/logger";

/** Counter storage for the limiter; Redis in production, a Map in tests. */
export interface RateLimitStore {
  /** Increments `key` and returns the new count, starting a window of `windowMs` on first hit. */
  hit(key: string, windowMs: number): Promise<number>;
  reset(key: string): Promise<void>;
}

export class RedisRateLimitStore implements RateLimitStore {
  async hit(key: string, windowMs: number): Promise<number> {
    const client = getClient();
    const count = await client.incr(key);
    // Fixed window: the TTL is set by the first hit only, so hammering the
    // endpoint cannot keep extending its own lockout (or anyone else's).
    if (count === 1) await client.pExpire(key, windowMs);
    return count;
  }

  async reset(key: string): Promise<void> {
    await getClient().del(key);
  }
}

export interface LoginRateLimitOptions {
  maxAttempts: number;
  windowMs: number;
}

/**
 * Fixed-window limit per (IP, username) on login attempts. It fails open: if
 * Redis is down, logins still work (bcrypt already makes guessing slow), since
 * locking every user out during a cache outage is the worse failure.
 */
export class LoginRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    private readonly options: LoginRateLimitOptions = {
      maxAttempts: 10,
      windowMs: 15 * 60 * 1000,
    },
  ) {}

  private key(ip: string, username: string): string {
    return `ratelimit:login:${ip}:${username.trim().toLowerCase()}`;
  }

  /** Records an attempt; resolves false when the caller is over the limit. */
  async attempt(ip: string, username: string): Promise<boolean> {
    try {
      const count = await this.store.hit(this.key(ip, username), this.options.windowMs);
      return count <= this.options.maxAttempts;
    } catch (err) {
      logger.warn({ err }, "Login rate limiter unavailable; allowing attempt");
      return true;
    }
  }

  async clear(ip: string, username: string): Promise<void> {
    await this.store.reset(this.key(ip, username)).catch((err: unknown) => {
      logger.warn({ err }, "Failed to reset login rate limit counter");
    });
  }
}
