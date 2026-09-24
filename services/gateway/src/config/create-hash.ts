import { createHash } from "crypto";

type CustomerHashInput = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  customFields?: { fieldSlug: string; value: string | null }[];
};

/**
 * Content hash of a customer row, used to deduplicate the staging log.
 * SHA-256 hex (64 chars), the same digest the fileparser sends for imported rows.
 */
export function buildCustomerRowHash(input: CustomerHashInput): string {
  const sortedCustomFields = (input.customFields || [])
    .map((f) => ({
      s: (f.fieldSlug || "").trim().toLowerCase(),
      v: (f.value || "").trim().toLowerCase(),
    }))
    .sort((a, b) => a.s.localeCompare(b.s));

  const normalized = {
    n: (input.name || "unknown customer").trim().toLowerCase(),
    e: (input.email || "").trim().toLowerCase(),
    p: (input.phone || "").trim().replace(/\s+/g, ""),
    f: sortedCustomFields,
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
