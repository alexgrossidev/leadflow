/**
 * Wall-clock arithmetic in an IANA timezone using only `Intl`, so opening
 * hours and daily counters follow the business's clock (including DST)
 * whatever timezone the server runs in.
 */

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock reading of `instant` in `timeZone`. */
export function toLocal(instant: Date, timeZone: string): LocalDateTime {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatter(timeZone).formatToParts(instant)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 0,
    day: parts.day ?? 0,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (e.g. +3_600_000 for CET). */
function offsetAt(instant: number, timeZone: string): number {
  const l = toLocal(new Date(instant), timeZone);
  const asUtc = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute, l.second);
  return asUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

/**
 * The instant at which the local clock in `timeZone` reads `date` +
 * `minuteOfDay`. The offset is re-read at the candidate instant so a date on
 * the other side of a DST change still lands on the right wall-clock time.
 */
export function fromLocal(date: LocalDate, minuteOfDay: number, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minuteOfDay);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  return new Date(second);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday, for a calendar date (timezone-independent). */
export function weekday(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** "YYYY-MM-DD" of `instant` in `timeZone`: the key of the daily counters. */
export function localDayKey(instant: Date, timeZone: string): string {
  const l = toLocal(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${l.year}-${pad(l.month)}-${pad(l.day)}`;
}

/** Local midnight at the start of the day after `instant`. */
export function startOfNextDay(instant: Date, timeZone: string): Date {
  return fromLocal(addDays(toLocal(instant, timeZone), 1), 0, timeZone);
}
