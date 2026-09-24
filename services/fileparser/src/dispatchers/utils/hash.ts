import { createHash } from "node:crypto";
import type { RawRecord } from "../pipeline/types.js";
import type { MappedCustomer } from "./fieldMapping.js";

/**
 * Staging dedup key: sha256 over the row's (header, value) pairs sorted by
 * header, so the same data yields the same key regardless of column order.
 * Returned as the raw 32-byte digest to fit `import_staging.data_hash BINARY(32)`.
 */
export function dedupHash(row: RawRecord): Buffer {
  const entries = Object.keys(row)
    .sort()
    .map((key) => [key, row[key]]);
  return createHash("sha256").update(JSON.stringify(entries)).digest();
}

/**
 * Hash the gateway uses to recognise a customer it has already imported.
 * Normalised (case, surrounding whitespace, spaces inside phone numbers) and
 * insensitive to custom-field order. Hex-encoded sha256, 64 characters.
 */
export function customerHash(customer: MappedCustomer): string {
  const fields = Object.keys(customer.customFields)
    .sort()
    .map((key) => [key, customer.customFields[key] ?? ""]);

  const normalized = {
    n: customer.name.trim().toLowerCase(),
    e: customer.email.trim().toLowerCase(),
    p: customer.phone.replace(/\s+/g, ""),
    f: fields,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
