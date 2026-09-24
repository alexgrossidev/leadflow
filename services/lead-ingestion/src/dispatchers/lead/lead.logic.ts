import type { FacebookLead } from "../../modules_inbound/fbLead/fbLead.table";

export type LeadRow = FacebookLead | null;

/**
 * Coerce a JSON column value to a plain object. On MariaDB `json` is an alias
 * for `longtext`, which the driver hands back as a (sometimes multiply-encoded)
 * string rather than a parsed object, so unwrap any string layers before use.
 * Returns null when the value isn't a JSON object.
 */
export function asJsonObject(value: unknown): Record<string, unknown> | null {
  let v: unknown = value;
  for (let i = 0; i < 4 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

// ── Stage guards ─────────────────────────────────────────────────────────────
// Each maps the persisted lead row to whether its stage still has work to do,
// so a retried job resumes from the last completed stage instead of replaying.

export const needsFetch = (row: LeadRow): boolean => !row || !row.fetched;

/**
 * A parsed row's clean_response is a real Lead (has a `leadId`); the fetch
 * placeholder is an empty `{}`. We check for `leadId` rather than key-count so a
 * string-encoded column value can't masquerade as "parsed" (Object.keys on a
 * string returns character indices).
 */
export const isParsed = (row: LeadRow): boolean => {
  const clean = asJsonObject(row?.cleanResponse);
  return !!clean && typeof clean.leadId === "string";
};

export const needsDelivery = (row: LeadRow): boolean => !!row && !row.delivered;
