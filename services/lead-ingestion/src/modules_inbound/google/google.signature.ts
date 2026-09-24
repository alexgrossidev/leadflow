import crypto from "crypto";

/** Header the registering service sends the body HMAC in. */
export const GOOGLE_SIGNATURE_HEADER = "x-leadflow-signature";
const PREFIX = "sha256=";

/**
 * Constant-time check that `header` is the HMAC-SHA256 of `rawBody` under
 * `secret`. Pure (no env) so it is trivially testable. Returns false — never
 * throws — for any malformed input so the caller decides the HTTP outcome.
 */
export function isValidGoogleSignature(
  rawBody: Buffer | string | undefined,
  header: string | string[] | undefined,
  secret: string,
): boolean {
  const signature = Array.isArray(header) ? header[0] : header;
  if (!rawBody || !signature?.startsWith(PREFIX)) return false;

  const expected =
    PREFIX + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  const received = Buffer.from(signature);
  const computed = Buffer.from(expected);
  return (
    received.length === computed.length &&
    crypto.timingSafeEqual(received, computed)
  );
}
