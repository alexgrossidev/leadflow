import type { Settings } from "#modules/settings/settings.table";

/** Pipeline stages. Each is a separate job on the sender.process queue (the job name suffix). */
export enum SenderSteps {
  CLEAN_DATA = "CLEAN_DATA",
  CALCULATE_LIMITS = "CALCULATE_LIMITS",
  CALCULATE_DEAD_TIME = "CALCULATE_DEAD_TIME",
  DELIVER = "DELIVER",
}

export const DEFAULT_TIMEZONE = "Europe/Rome";

/** Used for any business without a settings row. */
export const defaultSettings: Settings = {
  businessId: 0,
  validateForBusinessHours: false,
  inWarmUpMode: false,
  maxEmails: 100,
  maxWhatsapps: 100,
  toleranceRate: 10,
  minimumWaitBetweenMessages: 60,
  timezone: DEFAULT_TIMEZONE,
};

/** Per-channel daily cap while a business is warming up a new sender reputation. */
export const WARM_UP_DAILY_CAP = 20;

/** Index = JS `getDay()` value. */
export const DAYS_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** Randomises wake-ups so a backlog does not fire all at once when a business opens. */
export const OPENING_JITTER_MS = 5 * 60_000;

/** Delay for a stage that asks to be retried without saying when. */
export const DEFAULT_RETRY_DELAY_MS = 60_000;

/** A message rescheduled this many times is recorded as failed instead of looping forever. */
export const MAX_RESCHEDULES = 50;

/** Attempts BullMQ makes for one stage job (e.g. transient SMTP errors). */
export const STAGE_ATTEMPTS = 3;
