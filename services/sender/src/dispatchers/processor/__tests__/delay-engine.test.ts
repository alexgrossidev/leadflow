import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { fatigueAfter, HumanDelayEngine, nextState } from "../shared/delay-engine";
import type { HumanizerConfig, State, UserBehaviorProfile } from "../shared/delay-engine.types";
import { createUserProfile, mulberry32 } from "../shared";

const config: HumanizerConfig = { baseMin: 2_000, baseMax: 8_000, spikeMin: 60_000, spikeMax: 300_000, timeInfluence: true };

const neutral: UserBehaviorProfile = {
  speed: 1,
  consistency: 0.5,
  focusBias: 0,
  breakBias: 0,
  circadianShift: 0,
  burstiness: 0,
};

const profileArb = fc.record({
  speed: fc.double({ min: 0.5, max: 1.5, noNaN: true }),
  consistency: fc.double({ min: 0, max: 1, noNaN: true }),
  focusBias: fc.double({ min: 0, max: 1, noNaN: true }),
  breakBias: fc.double({ min: 0, max: 1, noNaN: true }),
  circadianShift: fc.double({ min: -3, max: 3, noNaN: true }),
  burstiness: fc.double({ min: 0, max: 1, noNaN: true }),
});

describe("nextState", () => {
  it.each<[State, number, State]>([
    ["NORMAL", 0.1, "FOCUSED"],
    ["NORMAL", 0.6, "NORMAL"],
    ["NORMAL", 0.9, "DISTRACTED"],
    ["NORMAL", 0.99, "IDLE"],
    ["FOCUSED", 0.5, "FOCUSED"],
    ["FOCUSED", 0.8, "NORMAL"],
    ["DISTRACTED", 0.3, "DISTRACTED"],
    ["DISTRACTED", 0.7, "NORMAL"],
    ["DISTRACTED", 0.9, "IDLE"],
    ["IDLE", 0.2, "NORMAL"],
    ["IDLE", 0.7, "DISTRACTED"],
  ])("%s with r=%s -> %s (neutral profile)", (from, r, to) => {
    expect(nextState(from, r, neutral)).toBe(to);
  });

  it("lets a focused user stay focused longer", () => {
    expect(nextState("FOCUSED", 0.8, neutral)).toBe("NORMAL");
    expect(nextState("FOCUSED", 0.8, { ...neutral, focusBias: 1 })).toBe("FOCUSED");
  });

  it("always returns a valid state", () => {
    fc.assert(
      fc.property(fc.constantFrom<State>("FOCUSED", "NORMAL", "DISTRACTED", "IDLE"), fc.double({ min: 0, max: 0.9999, noNaN: true }), profileArb, (s, r, p) => {
        expect(["FOCUSED", "NORMAL", "DISTRACTED", "IDLE"]).toContain(nextState(s, r, p));
      }),
    );
  });
});

describe("HumanDelayEngine", () => {
  it("keeps every delay within [baseMin, spikeMax]", () => {
    fc.assert(
      fc.property(fc.integer(), profileArb, fc.integer({ min: 0, max: 23 }), fc.double({ min: 0, max: 5, noNaN: true }), (seed, profile, hour, fatigue) => {
        const engine = new HumanDelayEngine(config, profile, { rng: mulberry32(seed), localHour: () => hour, state: { fatigue } });
        for (let i = 0; i < 20; i++) {
          const delay = engine.nextDelay();
          expect(delay).toBeGreaterThanOrEqual(config.baseMin);
          expect(delay).toBeLessThanOrEqual(config.spikeMax);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("is deterministic for a given seed", () => {
    const run = (seed: number) => {
      const engine = new HumanDelayEngine(config, createUserProfile(7), { rng: mulberry32(seed), localHour: () => 11 });
      return Array.from({ length: 10 }, () => engine.nextDelay());
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it("takes a break (IDLE, spike range) when the spike draw hits", () => {
    const draws = [0, 0.5]; // spike check passes, then spike position
    const engine = new HumanDelayEngine(config, neutral, { rng: () => draws.shift() ?? 0.5, localHour: () => 11 });
    expect(engine.nextDelay()).toBe(180_000);
    expect(engine.getState().currentState).toBe("IDLE");
  });

  it("accumulates fatigue across messages, capped at 5", () => {
    const engine = new HumanDelayEngine(config, neutral, { rng: mulberry32(1), localHour: () => 11 });
    const before = engine.getState().fatigue;
    engine.nextDelay();
    expect(engine.getState().fatigue).toBeGreaterThan(before);
    expect(fatigueAfter(10_000, neutral)).toBe(5);
  });

  it("is slower at night than in office hours", () => {
    const at = (hour: number) =>
      new HumanDelayEngine(config, neutral, { rng: mulberry32(9), localHour: () => hour }).nextDelay();
    expect(at(3)).toBeGreaterThan(at(11));
  });
});

describe("createUserProfile", () => {
  it("is deterministic per user and differs between users", () => {
    expect(createUserProfile(12)).toEqual(createUserProfile(12));
    expect(createUserProfile(12)).not.toEqual(createUserProfile(13));
  });

  it("stays within the documented ranges", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2 ** 31 - 1 }), (userId) => {
        const p = createUserProfile(userId);
        expect(p.speed).toBeGreaterThanOrEqual(0.5);
        expect(p.speed).toBeLessThan(1.5);
        expect(p.circadianShift).toBeGreaterThanOrEqual(-3);
        expect(p.circadianShift).toBeLessThan(3);
        for (const v of [p.consistency, p.focusBias, p.breakBias, p.burstiness]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
    );
  });
});
