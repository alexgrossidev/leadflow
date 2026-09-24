import { DAYS_ORDER } from "#config/constants";
import type { OpeningDay } from "#modules/openingTimes/openingTimes.table";

export interface OpeningTimesOptions {
  openDays?: readonly string[];
  morningOpen?: string;
  morningClose?: string;
  afternoonOpen?: string;
  afternoonClose?: string;
  isContinuous?: boolean;
}

/** A weekly schedule with the same hours on every open day. */
export function createDefaultOpeningTimes(options: OpeningTimesOptions = {}): OpeningDay[] {
  const {
    openDays = ["mon", "tue", "wed", "thu", "fri"],
    morningOpen = "09:00",
    morningClose = "13:00",
    afternoonOpen = "14:00",
    afternoonClose = "18:00",
    isContinuous = false,
  } = options;
  return DAYS_ORDER.map((day) => {
    const isOpen = openDays.includes(day);
    return {
      day,
      morningOpen: isOpen ? morningOpen : null,
      morningClose: isOpen ? morningClose : null,
      afternoonOpen: isOpen ? afternoonOpen : null,
      afternoonClose: isOpen ? afternoonClose : null,
      isContinuous,
      isOpen,
    };
  });
}

export const DEFAULT_OPENING_TIMES = createDefaultOpeningTimes();
