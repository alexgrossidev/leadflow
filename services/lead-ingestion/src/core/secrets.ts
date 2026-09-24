import crypto from "crypto";

/**
 * Constant-time string comparison. Both sides are hashed first so the
 * comparison is fixed-length and the length of the secret does not leak
 * through an early return.
 */
export function safeEqual(received: string | undefined, expected: string): boolean {
  if (typeof received !== "string") return false;
  const a = crypto.createHash("sha256").update(received).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Pull a single header value; Node exposes repeated headers as arrays. */
export function headerValue(
  header: string | string[] | undefined,
): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

/** SHA-256 hex digest; used to persist a fingerprint of a secret instead of the secret. */
export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
