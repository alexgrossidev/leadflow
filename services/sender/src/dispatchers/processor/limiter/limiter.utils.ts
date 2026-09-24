import { DAYS_ORDER, OPENING_JITTER_MS, WARM_UP_DAILY_CAP } from "#config/constants";
import type { OpeningDay } from "#modules/openingTimes/openingTimes.table";
import type { Settings } from "#modules/settings/settings.table";
import type { DailyUsage } from "#modules/usage/usage.table";
import { addDays, fromLocal, toLocal, weekday } from "./time.utils";

export type Channel = "email" | "whatsapp";

/** "HH:MM" or "HH:MM:SS" → minutes since midnight; null for anything else. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** A day's open windows as [start, end) minute ranges, earliest first. */
export function dayWindows(day: OpeningDay): Array<[number, number]> {
  if (!day.isOpen) return [];
  const mOpen = timeToMinutes(day.morningOpen);
  const mClose = timeToMinutes(day.morningClose);
  const aOpen = timeToMinutes(day.afternoonOpen);
  const aClose = timeToMinutes(day.afternoonClose);

  const valid = (start: number | null, end: number | null): Array<[number, number]> =>
    start !== null && end !== null && start < end ? [[start, end]] : [];

  if (day.isContinuous) return valid(mOpen ?? aOpen, aClose ?? mClose);
  return [...valid(mOpen, mClose), ...valid(aOpen, aClose)].sort((a, b) => a[0] - b[0]);
}

/** Whether `minuteOfDay` falls inside one of the day's windows (closing minute excluded). */
export function isWithinBusinessHours(day: OpeningDay, minuteOfDay: number): boolean {
  return dayWindows(day).some(([start, end]) => minuteOfDay >= start && minuteOfDay < end);
}

/**
 * The first instant at or after `from` when the business is open: `from`
 * itself if a window is open, else the next window's start (later today, after
 * lunch, or on a following day). Null when the schedule has no open window.
 */
export function nextOpenInstant(schedule: OpeningDay[], from: Date, timeZone: string): Date | null {
  const byDay = new Map(schedule.map((day) => [day.day, day]));
  const local = toLocal(from, timeZone);
  const minuteNow = local.hour * 60 + local.minute;

  // Eight days: today's later windows, then every weekday once, then today's again.
  for (let offset = 0; offset <= 7; offset++) {
    const date = addDays(local, offset);
    const day = byDay.get(DAYS_ORDER[weekday(date)] ?? "sun");
    if (!day) continue;
    for (const [start, end] of dayWindows(day)) {
      if (offset === 0) {
        if (minuteNow >= start && minuteNow < end) return from;
        if (start <= minuteNow) continue;
      }
      return fromLocal(date, start, timeZone);
    }
  }
  return null;
}

/**
 * Milliseconds until the business next opens (0 if open now), plus up to
 * `jitterMs` of random spread so queued messages do not all wake at once.
 * Null when the schedule never opens.
 */
export function getMsUntilNextOpen(
  schedule: OpeningDay[],
  now: Date,
  timeZone: string,
  rng: () => number = Math.random,
  jitterMs: number = OPENING_JITTER_MS,
): number | null {
  const opensAt = nextOpenInstant(schedule, now, timeZone);
  if (!opensAt) return null;
  const wait = opensAt.getTime() - now.getTime();
  return wait <= 0 ? 0 : wait + Math.floor(rng() * jitterMs);
}

/** Today's cap for a channel: the configured maximum minus the tolerance margin. */
export function dailyCap(settings: Settings, channel: Channel): number {
  const max = channel === "email" ? settings.maxEmails : settings.maxWhatsapps;
  const cap = Math.floor(max * (1 - settings.toleranceRate / 100));
  return settings.inWarmUpMode ? Math.min(cap, WARM_UP_DAILY_CAP) : cap;
}

export function isUnderDailyCap(settings: Settings, channel: Channel, usage: DailyUsage): boolean {
  const sent = channel === "email" ? usage.emailsSent : usage.whatsappSent;
  return sent < dailyCap(settings, channel);
}
