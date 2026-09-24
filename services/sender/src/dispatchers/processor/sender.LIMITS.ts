import type { OpeningDay } from "#modules/openingTimes/openingTimes.table";
import type { Settings } from "#modules/settings/settings.table";
import type { DailyUsage } from "#modules/usage/usage.table";
import type { SenderMessage } from "#workers/internal/validation";
import { getMsUntilNextOpen, isUnderDailyCap } from "./limiter/limiter.utils";
import { resolveSenderUserId } from "./limiter/multiseat";
import { localDayKey, startOfNextDay } from "./limiter/time.utils";
import type { StageResult } from "./types";

export interface LimitsDeps {
  settings: { getForBusiness(businessId: number): Promise<Settings> };
  openingTimes: { getWeek(businessId: number): Promise<OpeningDay[]> };
  multiseat: { isEnabled(businessId: number): Promise<boolean> };
  usage: { get(userId: number, day: string): Promise<DailyUsage> };
}

/**
 * Holds the message back until the sending user is under today's cap for the
 * channel and, when the business enforces it, inside opening hours. Both
 * are evaluated in the business's timezone. On success the message carries
 * the user whose limits apply (the assigned user in multiseat mode).
 */
export async function SENDER_LIMITS(
  message: SenderMessage,
  deps: LimitsDeps,
  now: Date,
  rng: () => number,
): Promise<StageResult> {
  const settings = await deps.settings.getForBusiness(message.businessId);
  const tz = settings.timezone;
  const userId = await resolveSenderUserId(
    deps.multiseat,
    message.businessId,
    message.userId,
    message.recipientData.assignedToUserId,
  );
  const schedule = settings.validateForBusinessHours
    ? await deps.openingTimes.getWeek(message.businessId)
    : null;

  const usage = await deps.usage.get(userId, localDayKey(now, tz));
  if (!isUnderDailyCap(settings, message.content.type, usage)) {
    // Tomorrow's counters start at zero; wait for tomorrow's first opening.
    const tomorrow = startOfNextDay(now, tz);
    const wait = schedule ? getMsUntilNextOpen(schedule, tomorrow, tz, rng) : 0;
    if (wait === null) return { result: "FAILURE", error: "Business has no opening hours" };
    return {
      result: "DELAY",
      reason: "DAILY_LIMIT_REACHED",
      delayMs: tomorrow.getTime() - now.getTime() + wait,
    };
  }

  if (schedule) {
    const wait = getMsUntilNextOpen(schedule, now, tz, rng);
    if (wait === null) return { result: "FAILURE", error: "Business has no opening hours" };
    if (wait > 0) return { result: "DELAY", reason: "OUTSIDE_BUSINESS_HOURS", delayMs: wait };
  }

  return { result: "SUCCESS", payload: { ...message, userId } };
}
