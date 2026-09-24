import type { HumanizerConfig, InternalState, State, UserBehaviorProfile } from "./delay-engine.types";

/** How much each attention state stretches the base gap. */
const STATE_MULTIPLIER: Record<State, number> = {
  FOCUSED: 0.7,
  NORMAL: 1,
  DISTRACTED: 1.6,
  IDLE: 2.5,
};

const MAX_FATIGUE = 5;

/**
 * One step of the attention Markov chain. `r` is a uniform [0, 1) draw; the
 * profile biases the weights (focused users stay focused, break-prone users
 * drift to IDLE).
 */
export function nextState(current: State, r: number, profile: UserBehaviorProfile): State {
  switch (current) {
    case "NORMAL":
      if (r < 0.5 + profile.focusBias * 0.3) return "FOCUSED";
      if (r < 0.85) return "NORMAL";
      if (r < 0.95 + profile.breakBias * 0.05) return "DISTRACTED";
      return "IDLE";
    case "FOCUSED":
      return r < 0.7 + profile.focusBias * 0.2 ? "FOCUSED" : "NORMAL";
    case "DISTRACTED":
      if (r < 0.5) return "DISTRACTED";
      if (r < 0.8) return "NORMAL";
      return "IDLE";
    case "IDLE":
      return r < 0.6 - profile.breakBias * 0.3 ? "NORMAL" : "DISTRACTED";
  }
}

/** Fatigue a user has accumulated after `messages` sends. */
export function fatigueAfter(messages: number, profile: UserBehaviorProfile): number {
  return Math.min(MAX_FATIGUE, messages * (0.03 + (1 - profile.consistency) * 0.05));
}

export interface EngineOptions {
  /** Uniform [0, 1) source; inject a seeded one for reproducible output. */
  rng?: () => number;
  /** The user's local hour (0-23), for the time-of-day multiplier. */
  localHour?: () => number;
  state?: Partial<InternalState>;
}

/**
 * Produces human-looking gaps between messages: a gaussian around the base
 * range, stretched by the user's speed, attention state, time of day and
 * fatigue, with occasional long breaks. Every output is clamped to
 * [baseMin, spikeMax]. With an injected RNG the sequence is deterministic.
 */
export class HumanDelayEngine {
  private readonly rng: () => number;
  private readonly localHour: () => number;
  private state: InternalState;

  constructor(
    private readonly config: HumanizerConfig,
    private readonly profile: UserBehaviorProfile,
    options: EngineOptions = {},
  ) {
    this.rng = options.rng ?? Math.random;
    this.localHour = options.localHour ?? (() => new Date().getHours());
    this.state = { currentState: "NORMAL", lastDelay: 0, fatigue: 0, ...options.state };
  }

  getState(): Readonly<InternalState> {
    return this.state;
  }

  nextDelay(): number {
    const { config, profile } = this;
    const fatigue = Math.min(
      MAX_FATIGUE,
      this.state.fatigue + 0.03 + (1 - profile.consistency) * 0.05,
    );

    const spikeChance = 0.01 + profile.breakBias * 0.1 + fatigue * 0.02;
    if (this.rng() < spikeChance) {
      const spike = config.spikeMin + this.rng() * (config.spikeMax - config.spikeMin);
      return this.commit("IDLE", fatigue, spike);
    }

    const state = nextState(this.state.currentState, this.rng(), profile);
    const mean = (config.baseMin + config.baseMax) / 2;
    const std = (config.baseMax - config.baseMin) / 6;

    let delay = this.gaussian(mean, std) * profile.speed * STATE_MULTIPLIER[state];
    if (this.rng() < profile.burstiness * 0.3) delay *= 0.5;
    delay *= this.timeMultiplier();
    delay *= 1 + fatigue * 0.15;
    return this.commit(state, fatigue, delay);
  }

  private commit(state: State, fatigue: number, delay: number): number {
    const clamped = Math.min(this.config.spikeMax, Math.max(this.config.baseMin, delay));
    this.state = { currentState: state, fatigue, lastDelay: clamped };
    return clamped;
  }

  private timeMultiplier(): number {
    if (!this.config.timeInfluence) return 1;
    const hour = (((this.localHour() + this.profile.circadianShift) % 24) + 24) % 24;
    if (hour < 7) return 2.5;
    if (hour < 10) return 0.8;
    if (hour < 19) return 1;
    return 1.4;
  }

  /** Box–Muller transform. */
  private gaussian(mean: number, stdDev: number): number {
    const u = 1 - this.rng(); // (0, 1], keeps log() finite
    const v = this.rng();
    return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
