import crypto from "crypto";
import { describe, it, expect } from "vitest";
import { isValidGoogleSignature } from "#modules/google/google.signature";

const SECRET = "shared-secret";
const sign = (body: string, secret = SECRET) =>
  "sha256=" +
  crypto.createHmac("sha256", secret).update(body).digest("hex");

describe("isValidGoogleSignature", () => {
  const body = JSON.stringify({ responseId: "r1", answers: [] });

  it("accepts a correctly signed body", () => {
    expect(isValidGoogleSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejects a body signed with the wrong secret", () => {
    expect(isValidGoogleSignature(body, sign(body, "other"), SECRET)).toBe(
      false,
    );
  });

  it("rejects a tampered body", () => {
    const sig = sign(body);
    expect(isValidGoogleSignature(body + "x", sig, SECRET)).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(isValidGoogleSignature(body, undefined, SECRET)).toBe(false);
    expect(isValidGoogleSignature(body, "deadbeef", SECRET)).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(isValidGoogleSignature(undefined, sign(body), SECRET)).toBe(false);
  });

  it("accepts a header delivered as an array (takes the first)", () => {
    expect(isValidGoogleSignature(body, [sign(body)], SECRET)).toBe(true);
  });
});
