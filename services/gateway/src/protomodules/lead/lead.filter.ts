import { SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { leads } from "../../modules/lead/lead.table.js";

export const FILTER_OPERATORS = ["eq", "neq", "contains", "gt", "lt", "is_set", "is_not_set"] as const;

/** Contract #2 request, validated. Empty proto3 strings arrive as "". */
export const leadStreamRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("all"),
    userId: z.number().int().positive(),
    businessId: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("field"),
    userId: z.number().int().positive(),
    businessId: z.number().int().positive(),
    fieldName: z.string().trim().min(1).max(64),
    fieldOperator: z.enum(FILTER_OPERATORS),
    fieldValue: z.string().max(1000).default(""),
  }),
]);

export type LeadStreamRequest = z.infer<typeof leadStreamRequestSchema>;
export type LeadFieldFilter = Extract<LeadStreamRequest, { type: "field" }>;

/** Core columns addressable by name; anything else is a custom field slug. */
const CORE_COLUMNS = {
  status: leads.status,
  email: leads.email,
  phone: leads.phone,
  name: leads.name,
  full_name: leads.name,
} as const;

const NUMERIC = /^-?\d+(\.\d+)?$/;

/**
 * SQL expression for a custom field: the slug is JSON-quoted into a path and
 * bound as a parameter, so it can never alter the statement.
 */
function customFieldExpression(slug: string): SQL {
  const path = `$.${JSON.stringify(slug)}`;
  return sql`JSON_UNQUOTE(JSON_EXTRACT(${leads.customFields}, ${path}))`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Builds the WHERE predicate for one field filter.
 *
 * Semantics are shared with the automations service's in-memory `matchesRule`
 * (the backfill and the live `lead.created` path must enrol the same leads):
 * - comparisons ignore case and surrounding whitespace — made explicit here
 *   because JSON_UNQUOTE yields a binary-collated string;
 * - an empty value counts as "not set", and a lead without the field matches
 *   only `is_not_set` (plain SQL NULL semantics, including for `neq`);
 * - `gt`/`lt` compare numerically when both sides are numbers, else as text.
 */
export function buildLeadFieldCondition(filter: LeadFieldFilter): SQL {
  const column: SQL =
    filter.fieldName in CORE_COLUMNS
      ? sql`${CORE_COLUMNS[filter.fieldName as keyof typeof CORE_COLUMNS]}`
      : customFieldExpression(filter.fieldName);
  const actual = sql`LOWER(TRIM(${column}))`;
  const expected = filter.fieldValue.trim().toLowerCase();
  const isSet = sql`(${column} IS NOT NULL AND TRIM(${column}) <> '')`;

  const ordered = (op: SQL) =>
    NUMERIC.test(expected)
      ? sql`CASE WHEN TRIM(${column}) REGEXP ${NUMERIC.source}
          THEN CAST(TRIM(${column}) AS DECIMAL(30, 10)) ${op} CAST(${expected} AS DECIMAL(30, 10))
          ELSE ${actual} ${op} ${expected} END`
      : sql`${actual} ${op} ${expected}`;

  switch (filter.fieldOperator) {
    case "is_set":
      return isSet;
    case "is_not_set":
      return sql`NOT ${isSet}`;
    case "eq":
      return sql`(${isSet} AND ${actual} = ${expected})`;
    case "neq":
      return sql`(${isSet} AND ${actual} <> ${expected})`;
    case "contains":
      return sql`(${isSet} AND ${actual} LIKE ${`%${escapeLike(expected)}%`})`;
    case "gt":
      return sql`(${isSet} AND ${ordered(sql.raw(">"))})`;
    case "lt":
      return sql`(${isSet} AND ${ordered(sql.raw("<"))})`;
    default: {
      const unsupported: never = filter.fieldOperator;
      throw new Error(`Unsupported operator: ${String(unsupported)}`);
    }
  }
}
