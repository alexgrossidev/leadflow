import { randomUUID } from "node:crypto";

/** Prefixes a v4 UUID with a short type code, e.g. `IMP_2f1c…`, so ids are self-describing in logs. */
export function generateCodedUUID(code: string): string {
  return `${code}_${randomUUID()}`;
}
