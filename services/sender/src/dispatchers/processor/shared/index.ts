import type { UserBehaviorProfile } from "./delay-engine.types";

/** Small, fast seeded PRNG (uniform [0, 1)); good enough for behavioural jitter. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit string hash (Java's `hashCode`), used to derive seeds. */
export function hashSeed(...parts: Array<string | number>): number {
  const text = parts.join(":");
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * A user's behavioural traits, derived from their id: the same user always
 * paces the same way, different users differ, and nothing needs storing.
 */
export function createUserProfile(userId: number): UserBehaviorProfile {
  const rand = mulberry32(hashSeed("profile", userId));
  return {
    speed: 0.5 + rand(),
    consistency: rand(),
    focusBias: rand(),
    breakBias: rand(),
    circadianShift: (rand() - 0.5) * 6,
    burstiness: rand(),
  };
}
