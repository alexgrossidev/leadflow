import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time secret comparison. Both sides are hashed first so the
 * comparison runs on equal-length buffers and leaks neither content nor length.
 */
export function secretMatches(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
