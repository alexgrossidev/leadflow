import { CompleteImportWithSettingsPayload } from "@leadflow/shared/jobs";

type CustomFieldSettings = NonNullable<
  CompleteImportWithSettingsPayload["customfieldSettings"]
>;

/**
 * Number of leading spreadsheet columns mapped positionally to the core CRM
 * identity: column 1 = name, column 2 = email, column 3 = phone. Everything
 * else is a custom field that lands in the customer's `preferences` JSON.
 */
export const CORE_FIELD_COUNT = 3;

export interface PreparedColumnSettings {
  /** Custom-field columns to drop entirely (by source header). */
  deletionSet: Set<string>;
  /** New fields to create, keyed by their own column header. */
  importSet: Set<string>;
  /** Existing fields: source column header -> target key in `preferences`. */
  mergeMap: Map<string, string>;
}

export interface MappedCustomer {
  name: string;
  email: string;
  phone: string;
  /** The customer's `preferences` document: target key -> value. */
  customFields: Record<string, string>;
}

function coerce(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/**
 * Pre-computes O(1) lookup structures once per import so the per-row hot loop
 * stays allocation-free.
 */
export function prepareColumnSettings(
  settings?: CustomFieldSettings,
): PreparedColumnSettings {
  return {
    deletionSet: new Set(settings?.fieldsToDelete ?? []),
    importSet: new Set(settings?.import ?? []),
    mergeMap: new Map(
      (settings?.merges ?? []).map((m) => [m.fieldName, m.target]),
    ),
  };
}

/**
 * Builds a customer's `preferences` document from a staged spreadsheet row,
 * honouring the bulk-upload field settings:
 *
 *   - `merges`: the column already exists; its value is imported under the
 *     mapped `target` key (e.g. column "favoritelanguage" -> key "language",
 *     "industry" -> "industry").
 *   - `import`: the column is new; its value is stored under its own header.
 *   - `fieldsToDelete`: the column is excluded, even if also referenced above.
 *
 * When neither `merges` nor `import` is supplied, every non-core column is
 * imported as-is, so the default is "capture the whole file". Two sources that
 * resolve to the same key are concatenated rather than overwritten, so no value
 * is silently dropped.
 */
export function buildPreferences(
  rawData: Record<string, unknown>,
  prepared: PreparedColumnSettings,
): Record<string, string> {
  const { deletionSet, importSet, mergeMap } = prepared;
  const result: Record<string, string> = {};

  const append = (key: string, value: string): void => {
    if (!key || !value) return;
    result[key] = result[key] ? `${result[key]}, ${value}` : value;
  };

  const has = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(rawData, key);

  // No explicit mapping plan -> import every non-core column verbatim.
  if (mergeMap.size === 0 && importSet.size === 0) {
    const keys = Object.keys(rawData);
    for (let i = CORE_FIELD_COUNT; i < keys.length; i++) {
      const key = keys[i];
      if (deletionSet.has(key)) continue;
      append(key, coerce(rawData[key]));
    }
    return result;
  }

  // Existing fields: source header -> target key.
  for (const [source, target] of mergeMap) {
    if (deletionSet.has(source) || deletionSet.has(target)) continue;
    if (!has(source)) continue;
    append(target, coerce(rawData[source]));
  }

  // New fields: keyed by their own column header.
  for (const name of importSet) {
    if (deletionSet.has(name)) continue;
    if (!has(name)) continue;
    append(name, coerce(rawData[name]));
  }

  return result;
}

/**
 * Normalises a staged row into the core identity (positional columns 1/2/3)
 * plus its settings-driven `preferences` document.
 */
export function mapRowToCustomer(
  rawData: Record<string, unknown>,
  prepared: PreparedColumnSettings,
): MappedCustomer {
  const cells = Object.values(rawData);
  return {
    name: coerce(cells[0]),
    email: coerce(cells[1]),
    phone: coerce(cells[2]),
    customFields: buildPreferences(rawData, prepared),
  };
}
