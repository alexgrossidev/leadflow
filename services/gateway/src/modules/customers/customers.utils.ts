import { EavStagingRecord } from "./customer.types.js";

/**
 * Maximum rows per INSERT batch into the temporary staging table: 250 rows x 7
 * bound parameters stays far below MySQL's 65,535 placeholder limit.
 */
export const STAGING_CHUNK_SIZE = 250;

/** Maximum byte-length accepted for a single custom field value (TEXT column). */
export const MAX_FIELD_VALUE_BYTES = 65_535;

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/**
 * Rejects records that would not fit the staging columns. An empty `fieldSlug`
 * is valid: it is the placeholder row for a customer without custom fields.
 */
export function validateRecord(record: EavStagingRecord, index: number): void {
  if (!record.importSourceKey?.trim()) {
    throw new Error(`Record[${index}]: importSourceKey is required.`);
  }
  if (record.importSourceKey.length > 255) {
    throw new Error(`Record[${index}]: importSourceKey exceeds 255 characters.`);
  }
  if (record.fieldSlug.length > 255) {
    throw new Error(`Record[${index}]: fieldSlug exceeds 255 characters.`);
  }
  if (record.name.length > 255) {
    throw new Error(`Record[${index}]: name exceeds 255 characters.`);
  }
  if (record.email && record.email.length > 255) {
    throw new Error(`Record[${index}]: email exceeds 255 characters.`);
  }
  if (record.phone && record.phone.length > 100) {
    throw new Error(`Record[${index}]: phone exceeds 100 characters.`);
  }
  if (Buffer.byteLength(record.fieldValue, "utf8") > MAX_FIELD_VALUE_BYTES) {
    throw new Error(
      `Record[${index}]: fieldValue is too large (max ${MAX_FIELD_VALUE_BYTES} bytes).`,
    );
  }
}
