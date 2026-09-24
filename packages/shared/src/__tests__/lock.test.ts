import { describe, expect, it } from "vitest";
import { tryAcquireLock, withLeaderLock } from "../redis/lock";

/**
 * In-memory stand-in for the two Redis commands the lock uses, with the same
 * semantics as the real ones: SET NX EX and the compare-and-delete Lua script.
 */
function fakeRedis() {
  const store = new Map<string, { value: string; expiresAt: number }>();
  let now = 0;
  const live = (key: string) => {
    const entry = store.get(key);
    if (entry && entry.expiresAt <= now) store.delete(key);
    return store.get(key);
  };
  return {
    store,
    advance: (ms: number) => (now += ms),
    set: async (key: string, value: string, opts: { NX: boolean; EX: number }) => {
      if (opts.NX && live(key)) return null;
      store.set(key, { value, expiresAt: now + opts.EX * 1000 });
      return "OK";
    },
    eval: async (_script: string, opts: { keys: string[]; arguments: string[] }) => {
      const [key] = opts.keys;
      const [token] = opts.arguments;
      if (live(key!)?.value === token) {
        store.delete(key!);
        return 1;
      }
      return 0;
    },
  };
}

type FakeClient = Parameters<typeof tryAcquireLock>[1];

describe("tryAcquireLock", () => {
  it("grants the lock to one holder at a time", async () => {
    const redis = fakeRedis();
    const first = await tryAcquireLock({ key: "k" }, redis as unknown as FakeClient);
    const second = await tryAcquireLock({ key: "k" }, redis as unknown as FakeClient);
    expect(first).toBeTypeOf("function");
    expect(second).toBeNull();
  });

  it("releases so the next caller can acquire", async () => {
    const redis = fakeRedis();
    const release = await tryAcquireLock({ key: "k" }, redis as unknown as FakeClient);
    await expect(release!()).resolves.toBe(true);
    expect(await tryAcquireLock({ key: "k" }, redis as unknown as FakeClient)).not.toBeNull();
  });

  it("never deletes a lock that expired and was taken by someone else", async () => {
    const redis = fakeRedis();
    const releaseA = await tryAcquireLock({ key: "k", ttlSeconds: 1 }, redis as unknown as FakeClient);
    redis.advance(1_500); // A overruns its TTL
    const releaseB = await tryAcquireLock({ key: "k", ttlSeconds: 10 }, redis as unknown as FakeClient);
    expect(releaseB).not.toBeNull();

    await expect(releaseA!()).resolves.toBe(false); // A reports the overrun…
    expect(redis.store.has("k")).toBe(true); // …and B still holds the lock
  });
});

describe("withLeaderLock", () => {
  it("returns null without running the callback when the lock is held", async () => {
    const redis = fakeRedis();
    await tryAcquireLock({ key: "k" }, redis as unknown as FakeClient);
    let ran = false;
    const result = await withLeaderLock({ key: "k" }, async () => { ran = true; return 1; }, redis as unknown as FakeClient);
    expect(result).toBeNull();
    expect(ran).toBe(false);
  });

  it("releases the lock even when the callback throws, and surfaces the callback's error", async () => {
    const redis = fakeRedis();
    await expect(
      withLeaderLock({ key: "k" }, async () => { throw new Error("boom"); }, redis as unknown as FakeClient),
    ).rejects.toThrow("boom");
    expect(redis.store.has("k")).toBe(false);
  });
});
