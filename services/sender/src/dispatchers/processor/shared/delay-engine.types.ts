export type State = "FOCUSED" | "NORMAL" | "DISTRACTED" | "IDLE";

export interface HumanizerConfig {
  /** Bounds of the ordinary gap between two messages, in ms. */
  baseMin: number;
  baseMax: number;
  /** Bounds of an occasional long break, in ms; spikeMax is also the hard ceiling. */
  spikeMin: number;
  spikeMax: number;
  /** Slow down at night and in the evening, relative to the user's own rhythm. */
  timeInfluence?: boolean;
}

export interface InternalState {
  currentState: State;
  lastDelay: number;
  /** 0–5; each message adds a little, and fatigue lengthens gaps and makes breaks likelier. */
  fatigue: number;
}

/** Stable per-user traits; see `createUserProfile`. */
export interface UserBehaviorProfile {
  speed: number; // 0.5–1.5, multiplies every gap
  consistency: number; // 0–1, low = tires faster
  focusBias: number; // 0–1, tendency to stay FOCUSED
  breakBias: number; // 0–1, tendency to take breaks
  circadianShift: number; // -3 to +3 hours
  burstiness: number; // 0–1, chance of quick back-to-back replies
}
