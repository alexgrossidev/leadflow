import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { cleanEmailInput } from "../clean/clean.email";
import { cleanWhatsAppNumber } from "../clean/clean.whatsapp";
import { HumanReadableErrorMessages as EmailError, HumanReadablePhoneErrors as PhoneError } from "../types";

describe("cleanEmailInput", () => {
  it.each([
    ["ada@leadflow.dev", "ada@leadflow.dev", "none"],
    ["  Ada@LeadFlow.DEV ", "Ada@leadflow.dev", "none"],
    ["Ada Lovelace <ada@leadflow.dev>", "ada@leadflow.dev", "low"],
    ["mailto:ada@leadflow.dev", "ada@leadflow.dev", "none"],
    ["ada [at] leadflow [dot] dev", "ada@leadflow.dev", "none"],
    ["ada at leadflow dot dev", "ada@leadflow.dev", "none"],
    ["a da@leadflow.dev", "ada@leadflow.dev", "low"],
    ["ada..lovelace@leadflow.dev", "ada.lovelace@leadflow.dev", "none"],
    ["ada@gmial.com", "ada@gmail.com", "medium"],
    ["info@leadflow.dev", "info@leadflow.dev", "low"],
    ["ada@example.com", "ada@example.com", "high"],
  ])("repairs %j", (input, cleaned, warning) => {
    expect(cleanEmailInput(input)).toEqual({ success: true, cleanedData: cleaned, warningLevel: warning });
  });

  it.each([
    ["", EmailError.EMPTY_INPUT],
    ["   ", EmailError.EMPTY_INPUT],
    ["ada.leadflow.dev", EmailError.MISSING_AT],
    ["a@b@leadflow.dev", EmailError.INVALID_STRUCTURE],
    ["ada@leadflow.dev; bob@leadflow.dev", EmailError.MULTIPLE_EMAILS],
    ["ada@localhost", EmailError.INVALID_DOMAIN],
    ["ada@-bad-.dev", EmailError.INVALID_DOMAIN],
    [`${"a".repeat(250)}@leadflow.dev`, EmailError.TOO_LONG],
    ["ad(a)@leadflow.dev", EmailError.UNRECOVERABLE],
  ])("rejects %j", (input, error) => {
    expect(cleanEmailInput(input)).toMatchObject({ success: false, error });
  });

  it("is idempotent: cleaning a cleaned address changes nothing", () => {
    const local = fc.stringMatching(/^[A-Za-z0-9._+ -]{1,20}$/);
    const domain = fc.stringMatching(/^[A-Za-z0-9-]{1,12}\.[A-Za-z]{2,6}$/);
    const noise = fc.constantFrom("", " ", "mailto:", "<", ">", " ");
    fc.assert(
      fc.property(noise, local, domain, noise, (pre, l, d, post) => {
        const once = cleanEmailInput(`${pre}${l}@${d}${post}`);
        if (!once.success || !once.cleanedData) return;
        expect(cleanEmailInput(once.cleanedData).cleanedData).toBe(once.cleanedData);
      }),
      { numRuns: 500 },
    );
  });
});

describe("cleanWhatsAppNumber", () => {
  it.each([
    ["+39 333 123 4567", "+393331234567", "none"],
    ["0039 333 1234567", "+393331234567", "none"],
    ["333-123-4567", "+393331234567", "medium"],
    ["WhatsApp: +39 (333) 123 4567", "+393331234567", "none"],
    ["+44 07911 123456", "+447911123456", "medium"],
    ["+1 415 555 2671", "+14155552671", "none"],
    ["+39 333 555 1234", "+393335551234", "none"],
    ["+39 3333333333", "+393333333333", "high"],
    ["+39 1234567890", "+391234567890", "high"],
    ["+39 9876543210", "+399876543210", "high"],
    // Regression: an unknown one-digit country code keeps its leading zero,
    // otherwise "+3904567" would re-split as +39 on the next pass.
    ["+3 0904567", "+30904567", "medium"],
  ])("normalises %j", (input, cleaned, warning) => {
    expect(cleanWhatsAppNumber(input)).toEqual({ success: true, cleanedData: cleaned, warningLevel: warning });
  });

  it.each([
    ["", PhoneError.EMPTY_INPUT],
    ["call me", PhoneError.NO_DIGITS],
    ["+39 333 1234567, +39 333 7654321", PhoneError.MULTIPLE_NUMBERS],
    ["+39 +333 1234567", PhoneError.INVALID_STRUCTURE],
    ["+39 12", PhoneError.TOO_SHORT],
    ["+39 1234567890123456", PhoneError.TOO_LONG],
  ])("rejects %j", (input, error) => {
    expect(cleanWhatsAppNumber(input)).toMatchObject({ success: false, error });
  });

  it("is idempotent: cleaning a cleaned number changes nothing", () => {
    const digits = fc
      .array(fc.constantFrom(..."0123456789 ()-".split("")), { minLength: 1, maxLength: 16 })
      .map((chars) => chars.join(""));
    const prefix = fc.constantFrom("", "+", "00", "+39 ", "+44 0", "+3 0", "tel: ");
    fc.assert(
      fc.property(prefix, digits, (p, d) => {
        const once = cleanWhatsAppNumber(`${p}${d}`);
        if (!once.success || !once.cleanedData) return;
        expect(cleanWhatsAppNumber(once.cleanedData).cleanedData).toBe(once.cleanedData);
      }),
      { numRuns: 1000 },
    );
  });
});
