import type { CellValue, RawRecord } from "./types.js";

/** SheetJS names header-less columns "__EMPTY", "__EMPTY_1", ... */
const EMPTY_HEADER_PREFIX = "__EMPTY";

function toCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

/**
 * Turns a parser row into a staging record: drops columns without a header,
 * makes every cell JSON-safe, and returns null for rows with no content (blank
 * lines, trailing formatted-but-empty spreadsheet rows).
 */
export function normalizeRow(row: Record<string, unknown>): RawRecord | null {
  const record: RawRecord = {};
  let hasContent = false;

  for (const [key, value] of Object.entries(row)) {
    if (key.trim() === "" || key.startsWith(EMPTY_HEADER_PREFIX)) continue;
    const cell = toCell(value);
    record[key] = cell;
    if (cell !== null && String(cell).trim() !== "") hasContent = true;
  }

  return hasContent ? record : null;
}
