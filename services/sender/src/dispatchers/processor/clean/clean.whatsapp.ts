import {
  WarningLevel,
  CleanDataResult,
  HumanReadablePhoneErrors,
} from "#dispatchers/processor/types";
import { bump } from "./cleaner.utils";
import { inferCountryCode, splitCountryCode } from "./cleaner.utils";

export function cleanWhatsAppNumber(
  input: string,
  defaultCountry: "IT" | "US" | "GB" | "DE" | "FR" | "ES" = "IT",
): CleanDataResult {
  if (!input || typeof input !== "string") {
    return { success: false, error: HumanReadablePhoneErrors.EMPTY_INPUT };
  }

  let warningLevel: WarningLevel = "none";
  let working = input;

  // --- Step 1: Normalize whitespace & unicode ---
  working = working
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/\s+/g, " ")
    .trim();

  if (!working) {
    return { success: false, error: HumanReadablePhoneErrors.EMPTY_INPUT };
  }

  // --- Step 2: Detect multiple numbers ---
  const possibleSplits = working
    .split(/[;,|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (possibleSplits.length > 1) {
    return {
      success: false,
      error: HumanReadablePhoneErrors.MULTIPLE_NUMBERS,
    };
  }

  working = possibleSplits[0] || "";

  // --- Step 3: Strip common labels ---
  working = working.replace(
    /(phone|tel|mobile|whatsapp|cell|contact)[:\-]?\s*/gi,
    "",
  );

  // --- Step 4: Extract digits and plus ---
  const plusCount = (working.match(/\+/g) || []).length;
  if (plusCount > 1) {
    return {
      success: false,
      error: HumanReadablePhoneErrors.INVALID_STRUCTURE,
    };
  }

  // Convert 00 prefix → +
  working = working.replace(/^00/, "+");

  // Remove everything except digits and +
  working = working.replace(/[^\d+]/g, "");

  if (!/\d/.test(working)) {
    return { success: false, error: HumanReadablePhoneErrors.NO_DIGITS };
  }

  // --- Step 5: Normalize leading + ---
  if (working.startsWith("+")) {
    working = "+" + working.slice(1).replace(/\+/g, "");
  }

  // --- Step 6: Handle missing country code ---
  if (!working.startsWith("+")) {
    const inferred = inferCountryCode(defaultCountry);
    working = inferred + working;
    warningLevel = bump(warningLevel, "medium");
  }

  // --- Step 7: Split country code ---
  const { countryCode, nationalNumber, known } = splitCountryCode(working);

  if (!countryCode || !nationalNumber) {
    return {
      success: false,
      error: HumanReadablePhoneErrors.INVALID_STRUCTURE,
    };
  }

  let cleanedNational = nationalNumber;

  // --- Step 8: Remove the trunk zero (e.g. +44 07911 -> +44 7911) ---
  // Only for recognised country codes: with a guessed one-digit code the
  // stripped number would re-split differently on a second pass.
  if (known && cleanedNational.startsWith("0")) {
    cleanedNational = cleanedNational.replace(/^0+/, "");
    warningLevel = bump(warningLevel, "medium");
  }

  const final = `+${countryCode}${cleanedNational}`;

  // --- Step 9: Length validation (E.164 max 15 digits) ---
  const digitsOnly = final.replace(/\D/g, "");

  if (digitsOnly.length < 6) {
    return { success: false, error: HumanReadablePhoneErrors.TOO_SHORT };
  }

  if (digitsOnly.length > 15) {
    return { success: false, error: HumanReadablePhoneErrors.TOO_LONG };
  }

  // --- Step 10: Heuristics / risk scoring ---
  if (isPlaceholderNumber(cleanedNational)) {
    warningLevel = bump(warningLevel, "high");
  }

  if (cleanedNational.length < 8) {
    warningLevel = bump(warningLevel, "medium");
  }

  // --- Step 11: Final sanity ---
  if (!/^\+\d{6,15}$/.test(final)) {
    return {
      success: false,
      error: HumanReadablePhoneErrors.UNRECOVERABLE,
    };
  }

  return {
    success: true,
    cleanedData: final,
    warningLevel,
  };
}

const ASCENDING = "01234567890123456789";
const DESCENDING = "98765432109876543210";

/**
 * Numbers typed to get past a required field: one repeated digit
 * (3333333333) or a straight run (1234567890). Only the whole national
 * number counts; real numbers often contain short runs like "1234".
 */
function isPlaceholderNumber(national: string): boolean {
  if (/^(\d)\1+$/.test(national)) return true;
  return national.length >= 6 && (ASCENDING.includes(national) || DESCENDING.includes(national));
}
