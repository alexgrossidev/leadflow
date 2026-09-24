export function sanitize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(test|n\/a|none|null|undefined|-+)$/i, "");
}

/** Normalize a field name for map lookup. */
export function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Join multi-value arrays produced by checkbox / multi-select fields. */
export function joinValues(values: string[]): string {
  return values.map(sanitize).filter(Boolean).join(", ");
}
