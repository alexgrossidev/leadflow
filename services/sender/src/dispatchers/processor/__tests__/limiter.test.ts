import { describe, expect, it } from "vitest";
import {
  createDefaultOpeningTimes,
  DEFAULT_OPENING_TIMES,
} from "../limiter/limiter.types";
import {
  dailyCap,
  getMsUntilNextOpen,
  isUnderDailyCap,
  isWithinBusinessHours,
  nextOpenInstant,
  timeToMinutes,
} from "../limiter/limiter.utils";
import { localDayKey, startOfNextDay } from "../limiter/time.utils";
import { defaultSettings } from "#config/constants";
import type { OpeningDay } from "#modules/openingTimes/openingTimes.table";

const ROME = "Europe/Rome";
const noJitter = () => 0;

const day = (overrides: Partial<OpeningDay>): OpeningDay => ({
  day: "mon",
  morningOpen: "09:00",
  morningClose: "13:00",
  afternoonOpen: "14:00",
  afternoonClose: "18:00",
  isContinuous: false,
  isOpen: true,
  ...overrides,
});

describe("timeToMinutes", () => {
  it.each([
    ["00:00", 0],
    ["09:00", 540],
    ["9:30", 570],
    ["13:00:00", 780],
    ["23:59", 1439],
    ["24:00", null],
    ["12:60", null],
    ["noon", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(timeToMinutes(input)).toBe(expected);
  });
});

describe("isWithinBusinessHours", () => {
  const split = day({});
  const continuous = day({ isContinuous: true });
  const closed = day({ isOpen: false });

  it.each([
    ["split: morning", split, 9 * 60, true],
    ["split: opening minute counts", split, 9 * 60, true],
    ["split: lunch break", split, 13 * 60 + 30, false],
    ["split: closing minute excluded", split, 13 * 60, false],
    ["split: afternoon", split, 17 * 60 + 59, true],
    ["split: before opening", split, 8 * 60 + 59, false],
    ["continuous: lunch time is open", continuous, 13 * 60 + 30, true],
    ["continuous: after close", continuous, 18 * 60, false],
    ["closed day", closed, 10 * 60, false],
    ["midnight opening (00:00 is a valid time)", day({ morningOpen: "00:00" }), 30, true],
  ])("%s", (_name, hours, minute, expected) => {
    expect(isWithinBusinessHours(hours, minute)).toBe(expected);
  });
});

describe("nextOpenInstant / getMsUntilNextOpen (Europe/Rome)", () => {
  // March 2026: Rome is UTC+1 until the DST switch on Sunday 29 March.
  const cases: Array<[string, string, string]> = [
    ["open now returns now", "2026-03-10T09:30:00Z", "2026-03-10T09:30:00Z"], // Tue 10:30 local
    ["before opening waits for 09:00", "2026-03-10T06:00:00Z", "2026-03-10T08:00:00Z"],
    ["lunch break waits for the afternoon window", "2026-03-10T12:15:00Z", "2026-03-10T13:00:00Z"],
    ["after close waits for tomorrow", "2026-03-10T17:30:00Z", "2026-03-11T08:00:00Z"],
    ["Friday evening waits for Monday", "2026-03-13T18:00:00Z", "2026-03-16T08:00:00Z"],
    ["Saturday waits for Monday", "2026-03-14T10:00:00Z", "2026-03-16T08:00:00Z"],
    ["across the DST change, 09:00 is 07:00 UTC", "2026-03-27T18:00:00Z", "2026-03-30T07:00:00Z"],
  ];

  it.each(cases)("%s", (_name, now, expected) => {
    expect(nextOpenInstant(DEFAULT_OPENING_TIMES, new Date(now), ROME)?.toISOString()).toBe(
      new Date(expected).toISOString(),
    );
  });

  it("reports the wait in ms, zero when open, with jitter only when waiting", () => {
    const saturday = new Date("2026-03-14T10:00:00Z");
    expect(getMsUntilNextOpen(DEFAULT_OPENING_TIMES, saturday, ROME, noJitter)).toBe(46 * 3_600_000);
    expect(getMsUntilNextOpen(DEFAULT_OPENING_TIMES, saturday, ROME, () => 0.5, 60_000)).toBe(
      46 * 3_600_000 + 30_000,
    );
    expect(getMsUntilNextOpen(DEFAULT_OPENING_TIMES, new Date("2026-03-10T09:30:00Z"), ROME, () => 0.9)).toBe(0);
  });

  it("returns null when the schedule never opens", () => {
    const closedWeek = createDefaultOpeningTimes({ openDays: [] });
    expect(getMsUntilNextOpen(closedWeek, new Date("2026-03-10T09:30:00Z"), ROME)).toBeNull();
    expect(getMsUntilNextOpen([], new Date("2026-03-10T09:30:00Z"), ROME)).toBeNull();
  });

  it("finds today's window again one week later when it is the only one", () => {
    const tuesdaysOnly = createDefaultOpeningTimes({ openDays: ["tue"] });
    const tuesdayEvening = new Date("2026-03-10T19:00:00Z");
    expect(nextOpenInstant(tuesdaysOnly, tuesdayEvening, ROME)?.toISOString()).toBe("2026-03-17T08:00:00.000Z");
  });

  it("evaluates hours in the business's timezone, not the server's", () => {
    const utcMorning = new Date("2026-03-10T08:30:00Z"); // 09:30 in Rome, 04:30 in New York
    expect(nextOpenInstant(DEFAULT_OPENING_TIMES, utcMorning, ROME)).toEqual(utcMorning);
    expect(nextOpenInstant(DEFAULT_OPENING_TIMES, utcMorning, "America/New_York")?.toISOString()).toBe(
      "2026-03-10T13:00:00.000Z",
    );
  });
});

describe("local days", () => {
  it("keys counters by the business's calendar day", () => {
    const lateEvening = new Date("2026-03-10T23:30:00Z"); // already the 11th in Rome
    expect(localDayKey(lateEvening, ROME)).toBe("2026-03-11");
    expect(localDayKey(lateEvening, "UTC")).toBe("2026-03-10");
    expect(startOfNextDay(lateEvening, ROME).toISOString()).toBe("2026-03-11T23:00:00.000Z");
  });
});

describe("daily caps", () => {
  const settings = { ...defaultSettings, maxEmails: 100, maxWhatsapps: 10, toleranceRate: 10 };

  it("applies the tolerance margin per channel, with separate counters", () => {
    expect(dailyCap(settings, "email")).toBe(90);
    expect(dailyCap(settings, "whatsapp")).toBe(9);
    expect(isUnderDailyCap(settings, "email", { emailsSent: 89, whatsappSent: 50 })).toBe(true);
    expect(isUnderDailyCap(settings, "email", { emailsSent: 90, whatsappSent: 0 })).toBe(false);
    expect(isUnderDailyCap(settings, "whatsapp", { emailsSent: 0, whatsappSent: 9 })).toBe(false);
  });

  it("caps a business in warm-up mode", () => {
    expect(dailyCap({ ...settings, inWarmUpMode: true }, "email")).toBe(20);
  });
});
