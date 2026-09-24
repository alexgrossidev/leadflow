import type { LeadCreatedPayload } from "@leadflow/shared";

/**
 * Operators shared with the gateway's `LeadService.GetLeadWithFilters`, so a
 * rule selects the same leads whether it is evaluated here on `lead.created`
 * or by the gateway during a backfill.
 */
const RULE_OPERATORS = ["eq", "neq", "contains", "gt", "lt", "is_set", "is_not_set"] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/** Older gateway payloads spell the equality operators out. */
const OPERATOR_ALIASES: Record<string, RuleOperator> = {
  equals: "eq",
  not_equals: "neq",
};

export function normaliseOperator(raw: string): RuleOperator | null {
  const key = raw.trim().toLowerCase();
  const alias = OPERATOR_ALIASES[key];
  if (alias) return alias;
  return (RULE_OPERATORS as readonly string[]).includes(key) ? (key as RuleOperator) : null;
}

export interface Rule {
  field: string | null;
  operator: string | null;
  value: string | null;
}

export type MatchableLead = Pick<LeadCreatedPayload, "fullName" | "email" | "phone" | "source" | "fields">;

/**
 * Reads `field` from a lead. Core attributes are addressed by column name
 * (`name`/`full_name`, `email`, `phone`, `source`); anything else is a custom
 * field slug. `status` is not part of `lead.created`, so it is read from the
 * custom fields when the producer includes it there.
 */
function readField(lead: MatchableLead, field: string): string | null {
  switch (field.trim().toLowerCase()) {
    case "name":
    case "full_name":
    case "fullname":
      return lead.fullName;
    case "email":
      return lead.email;
    case "phone":
      return lead.phone;
    case "source":
      return lead.source;
    default:
      return lead.fields[field] ?? lead.fields[field.trim().toLowerCase()] ?? null;
  }
}

const asNumber = (value: string): number | null => {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

function compare(left: string, right: string): number {
  const a = asNumber(left);
  const b = asNumber(right);
  if (a !== null && b !== null) return a - b;
  return left.localeCompare(right);
}

/**
 * Evaluates an automation rule against a lead.
 *
 * Semantics mirror a SQL filter on a case-insensitive collation:
 * - comparisons ignore case and surrounding whitespace;
 * - an empty string counts as "not set";
 * - a missing value satisfies only `is_not_set` (as NULL would in SQL);
 * - `gt`/`lt` compare numerically when both sides are numbers, else as text.
 * A rule without a field matches every lead; an unknown operator matches none.
 */
export function matchesRule(rule: Rule, lead: MatchableLead): boolean {
  if (!rule.field || rule.field.trim() === "") return true;
  const operator = rule.operator ? normaliseOperator(rule.operator) : null;
  if (!operator) return false;

  const raw = readField(lead, rule.field);
  const actual = raw === null ? "" : raw.trim().toLowerCase();
  const isSet = actual !== "";

  if (operator === "is_set") return isSet;
  if (operator === "is_not_set") return !isSet;
  if (!isSet) return false;

  const expected = (rule.value ?? "").trim().toLowerCase();
  switch (operator) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "contains":
      return actual.includes(expected);
    case "gt":
      return compare(actual, expected) > 0;
    case "lt":
      return compare(actual, expected) < 0;
  }
}
