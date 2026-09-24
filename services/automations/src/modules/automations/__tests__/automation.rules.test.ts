import { describe, expect, it } from "vitest";
import { matchesRule, normaliseOperator, type MatchableLead, type Rule } from "../automation.rules";

const lead: MatchableLead = {
  fullName: "Ada Lovelace",
  email: "Ada@Example.org",
  phone: "+39 333 1234567",
  source: "facebook",
  fields: { budget: "1500", city: "Milano", status: "new", empty: "  " },
};

const rule = (field: string | null, operator: string | null, value: string | null = null): Rule => ({
  field,
  operator,
  value,
});

describe("matchesRule", () => {
  it.each([
    // [description, rule, expected]
    ["no field matches every lead", rule(null, null), true],
    ["blank field matches every lead", rule("  ", "eq", "x"), true],
    ["eq on a core field ignores case", rule("email", "eq", "ada@example.org"), true],
    ["eq trims both sides", rule("city", "eq", "  milano "), true],
    ["eq mismatch", rule("city", "eq", "Roma"), false],
    ["neq", rule("city", "neq", "Roma"), true],
    ["neq on the same value", rule("city", "neq", "MILANO"), false],
    ["contains on name", rule("name", "contains", "love"), true],
    ["full_name alias", rule("full_name", "contains", "ada"), true],
    ["contains mismatch", rule("name", "contains", "babbage"), false],
    ["gt compares numbers numerically", rule("budget", "gt", "900"), true],
    ["lt compares numbers numerically", rule("budget", "lt", "900"), false],
    ["gt falls back to text comparison", rule("city", "gt", "lecco"), true],
    ["source is a core field", rule("source", "eq", "facebook"), true],
    ["status is read from custom fields", rule("status", "eq", "NEW"), true],
    ["is_set on a present field", rule("budget", "is_set"), true],
    ["is_set on a missing field", rule("nope", "is_set"), false],
    ["whitespace-only counts as not set", rule("empty", "is_not_set"), true],
    ["is_not_set on a present field", rule("phone", "is_not_set"), false],
    ["missing field never satisfies neq (SQL NULL semantics)", rule("nope", "neq", "x"), false],
    ["missing field never satisfies eq", rule("nope", "eq", ""), false],
    ["legacy 'equals' alias", rule("city", "equals", "milano"), true],
    ["legacy 'not_equals' alias", rule("city", "not_equals", "milano"), false],
    ["unknown operator matches nothing", rule("city", "starts_with", "mi"), false],
    ["missing operator with a field matches nothing", rule("city", null, "milano"), false],
  ])("%s", (_description, r, expected) => {
    expect(matchesRule(r, lead)).toBe(expected);
  });

  it("reads custom fields case-insensitively by slug", () => {
    expect(matchesRule(rule("City", "eq", "milano"), { ...lead, fields: { city: "Milano" } })).toBe(true);
  });
});

describe("normaliseOperator", () => {
  it.each([
    ["eq", "eq"],
    [" IS_SET ", "is_set"],
    ["equals", "eq"],
    ["not_contains", null],
  ])("%s -> %s", (raw, expected) => {
    expect(normaliseOperator(raw)).toBe(expected);
  });
});
