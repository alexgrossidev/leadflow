import { WarningLevel } from "#dispatchers/processor/types";

export function bump(current: WarningLevel, next: WarningLevel): WarningLevel {
  const order: WarningLevel[] = ["none", "low", "medium", "high"];
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}

export function inferCountryCode(country: string): string {
  switch (country) {
    case "IT":
      return "+39";
    case "US":
      return "+1";
    case "GB":
      return "+44";
    case "DE":
      return "+49";
    case "FR":
      return "+33";
    case "ES":
      return "+34";
    default:
      return "+1";
  }
}

const KNOWN_COUNTRY_CODES = ["33", "34", "39", "44", "49", "1"]; // longest first

/**
 * Splits "+<country><national>" using the country codes we recognise; any
 * other number is assumed to have a one-digit code and flagged as `known: false`.
 */
export function splitCountryCode(input: string): {
  countryCode: string;
  nationalNumber: string;
  known: boolean;
} {
  const digits = input.replace("+", "");
  const code = KNOWN_COUNTRY_CODES.find((c) => digits.startsWith(c));
  if (code) return { countryCode: code, nationalNumber: digits.slice(code.length), known: true };
  return { countryCode: digits.slice(0, 1), nationalNumber: digits.slice(1), known: false };
}
