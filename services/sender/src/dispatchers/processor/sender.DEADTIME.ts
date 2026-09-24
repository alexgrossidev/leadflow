import type { Settings } from "#modules/settings/settings.table";
import type { DailyUsage } from "#modules/usage/usage.table";
import { createUserProfile, hashSeed, mulberry32 } from "./shared";
import { fatigueAfter, HumanDelayEngine } from "./shared/delay-engine";
import type { HumanizerConfig } from "./shared/delay-engine.types";
import { localDayKey, toLocal } from "./limiter/time.utils";
import type { StageResult } from "./types";

/** Jitter added on top of the business's minimum wait between messages. */
const PACING_CONFIG: HumanizerConfig = {
  baseMin: 2_000,
  baseMax: 8_000,
  spikeMin: 60_000,
  spikeMax: 300_000,
  timeInfluence: true,
};

export interface DeadTimeDeps {
  settings: { getForBusiness(businessId: number): Promise<Settings> };
  usage: {
    get(userId: number, day: string): Promise<DailyUsage>;
    lastSentAt(userId: number): Promise<Date | null>;
  };
}

/**
 * Earliest time the user may send again: last send + minimum wait + a
 * human-looking gap. Pacing is stateless per message: the gap is drawn from
 * the user's deterministic profile with an RNG seeded by (user, last send),
 * so re-evaluating the same gap always gives the same answer, and fatigue
 * comes from today's persisted send count rather than in-memory state.
 */
async function notBefore(
  userId: number,
  businessId: number,
  deps: DeadTimeDeps,
  now: Date,
): Promise<Date | null> {
  const lastSentAt = await deps.usage.lastSentAt(userId);
  if (!lastSentAt) return null;

  const settings = await deps.settings.getForBusiness(businessId);
  const usage = await deps.usage.get(userId, localDayKey(now, settings.timezone));
  const profile = createUserProfile(userId);
  const engine = new HumanDelayEngine(PACING_CONFIG, profile, {
    rng: mulberry32(hashSeed("gap", userId, lastSentAt.getTime())),
    localHour: () => toLocal(lastSentAt, settings.timezone).hour,
    state: { fatigue: fatigueAfter(usage.emailsSent + usage.whatsappSent, profile) },
  });

  const gapMs = settings.minimumWaitBetweenMessages * 1000 + engine.nextDelay();
  return new Date(lastSentAt.getTime() + gapMs);
}

export async function SENDER_DEADTIME(
  userId: number,
  businessId: number,
  deps: DeadTimeDeps,
  now: Date,
): Promise<StageResult> {
  const earliest = await notBefore(userId, businessId, deps, now);
  if (!earliest || now.getTime() >= earliest.getTime()) return { result: "SUCCESS" };
  return { result: "DELAY", reason: "PACING", delayMs: earliest.getTime() - now.getTime() };
}
