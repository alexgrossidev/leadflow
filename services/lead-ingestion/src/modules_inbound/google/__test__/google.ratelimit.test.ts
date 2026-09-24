import { describe, it, expect, vi } from "vitest";
import { makeRedisRateLimiter } from "../google.ratelimit";

/** In-memory stand-in for the node-redis INCR/PEXPIRE surface. */
function fakeClient() {
  const counts = new Map<string, number>();
  const pExpire = vi.fn().mockResolvedValue(true);
  const pTTL = vi.fn().mockResolvedValue(30_000);
  const incr = vi.fn(async (key: string) => {
    const next = (counts.get(key) ?? 0) + 1;
    counts.set(key, next);
    return next;
  });
  return { incr, pExpire, pTTL };
}

describe("makeRedisRateLimiter (fixed window)", () => {
  it("allows up to the limit then denies, setting the TTL once", async () => {
    const client = fakeClient();
    const limiter = makeRedisRateLimiter(async () => client);

    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(await limiter.allow("1001:2001:form", 3, 60_000));
    }

    expect(results).toEqual([true, true, true, false]);
    // TTL is set only on the first hit of the window.
    expect(client.pExpire).toHaveBeenCalledTimes(1);
    expect(client.pExpire).toHaveBeenCalledWith("gforms:rate:1001:2001:form", 60_000);
  });

  it("counts sources independently", async () => {
    const client = fakeClient();
    const limiter = makeRedisRateLimiter(async () => client);

    expect(await limiter.allow("a", 1, 1000)).toBe(true);
    expect(await limiter.allow("a", 1, 1000)).toBe(false);
    expect(await limiter.allow("b", 1, 1000)).toBe(true);
  });

  it("re-arms a counter left without a TTL, so a source is never blocked forever", async () => {
    const client = fakeClient();
    client.pTTL.mockResolvedValue(-1); // INCR landed, PEXPIRE did not
    const limiter = makeRedisRateLimiter(async () => client);

    await limiter.allow("orphan", 1, 5_000);
    await limiter.allow("orphan", 1, 5_000);

    expect(client.pExpire).toHaveBeenLastCalledWith("gforms:rate:orphan", 5_000);
    expect(client.pExpire).toHaveBeenCalledTimes(2);
  });
});
