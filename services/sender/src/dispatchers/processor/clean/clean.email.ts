import {
  HumanReadableErrorMessages,
  WarningLevel,
  CleanDataResult,
} from "#dispatchers/processor/types";
import { bump } from "./cleaner.utils";

export function cleanEmailInput(input: string): CleanDataResult {
  if (!input || typeof input !== "string") {
    return { success: false, error: HumanReadableErrorMessages.EMPTY_INPUT };
  }

  let warningLevel: WarningLevel = "none";
  let working = input;

  // --- Step 1: Normalize basic junk ---
  working = working
    .replace(/\u00A0/g, " ") // non-breaking spaces
    .replace(/\s+/g, " ")
    .trim();

  if (working.length === 0) {
    return { success: false, error: HumanReadableErrorMessages.EMPTY_INPUT };
  }

  // --- Step 2: Extract email from common formats ---
  // e.g. "John <john@example.com>"
  const angleMatch = working.match(/<([^<>]+)>/);
  if (angleMatch && angleMatch[1]) {
    working = angleMatch[1];
    warningLevel = bump(warningLevel, "low");
  }

  // Remove prefixes like "mailto:"
  working = working.replace(/^mailto:/i, "");

  // --- Step 3: Replace common human formats ---
  working = working
    .replace(/\s*\[at\]\s*|\s+at\s+/gi, "@")
    .replace(/\s*\[dot\]\s*|\s+dot\s+/gi, ".");

  // --- Step 4: Split multiple emails ---
  const multiSplit = working
    .split(/[;,|/]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (multiSplit.length > 1) {
    return {
      success: false,
      error: HumanReadableErrorMessages.MULTIPLE_EMAILS,
    };
  }

  working = multiSplit[0] || "";

  // --- Step 5: Remove illegal surrounding chars ---
  working = working.replace(/^[<>\s"'`]+/, "").replace(/[<>\s"'`,;]+$/, "");

  // --- Step 6: Remove internal spaces ---
  if (/\s/.test(working)) {
    working = working.replace(/\s+/g, "");
    warningLevel = bump(warningLevel, "low");
  }

  // --- Step 7: Basic structure check ---
  const atCount = (working.match(/@/g) || []).length;
  if (atCount === 0) {
    return { success: false, error: HumanReadableErrorMessages.MISSING_AT };
  }
  if (atCount > 1) {
    return {
      success: false,
      error: HumanReadableErrorMessages.INVALID_STRUCTURE,
    };
  }

  let [local, domain] = working.split("@");

  if (!local || !domain) {
    return {
      success: false,
      error: HumanReadableErrorMessages.INVALID_STRUCTURE,
    };
  }

  // --- Step 8: Clean local part ---
  local = local.replace(/^\.+/, "").replace(/\.+$/, "").replace(/\.\.+/g, ".");

  if (!local) {
    return { success: false, error: HumanReadableErrorMessages.INVALID_LOCAL };
  }

  // --- Step 9: Clean domain ---
  domain = domain
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/\.\.+/g, ".");

  // Fix common domain typos (extend this list over time)
  const domainFixes: Record<string, string> = {
    "gmal.com": "gmail.com",
    "gmial.com": "gmail.com",
    "gnail.com": "gmail.com",
    "hotnail.com": "hotmail.com",
    "yaho.com": "yahoo.com",
  };

  if (domainFixes[domain]) {
    domain = domainFixes[domain];
    warningLevel = bump(warningLevel, "medium");
  }

  // --- Step 10: Domain validation ---
  const domainParts = domain?.split(".");
  if (!domainParts || domainParts.length < 2) {
    return { success: false, error: HumanReadableErrorMessages.INVALID_DOMAIN };
  }

  if (domainParts.some((p) => !p || /[^a-z0-9-]/i.test(p))) {
    return { success: false, error: HumanReadableErrorMessages.INVALID_DOMAIN };
  }

  if (domainParts.some((p) => p.startsWith("-") || p.endsWith("-"))) {
    return { success: false, error: HumanReadableErrorMessages.INVALID_DOMAIN };
  }

  // --- Step 11: Length checks ---
  const full = `${local}@${domain}`;
  if (full.length > 254) {
    return { success: false, error: HumanReadableErrorMessages.TOO_LONG };
  }

  // --- Step 12: Final regex sanity check ---
  const basicEmailRegex =
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

  if (!basicEmailRegex.test(full)) {
    return {
      success: false,
      error: HumanReadableErrorMessages.UNRECOVERABLE,
    };
  }

  // --- Step 13: Risk heuristics ---
  if (/^(info|admin|support|sales)@/i.test(full)) {
    warningLevel = bump(warningLevel, "low");
  }

  if (/\+/.test(local)) {
    warningLevel = bump(warningLevel, "low");
  }

  if (/example\.com|test\.com/.test(domain?.toLowerCase() || "")) {
    warningLevel = bump(warningLevel, "high");
  }

  return {
    success: true,
    cleanedData: full,
    warningLevel,
  };
}
