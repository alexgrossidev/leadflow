import crypto from "crypto";
import { describe, it, expect } from "vitest";
import {
  createOAuthState,
  InvalidOAuthStateError,
  OAUTH_STATE_TTL_MS,
  verifyOAuthState,
} from "../oauth.state";

const SECRET = "a-secret-that-is-long-enough-for-hmac";
const NOW = 1_780_000_000_000;
const account = { businessId: 2001, userId: 1001 };

describe("OAuth state", () => {
  it("round-trips the account it was issued for", () => {
    const state = createOAuthState(account, SECRET, NOW);
    const claims = verifyOAuthState(state, SECRET, NOW + 1_000);
    expect(claims).toMatchObject({ ...account, iat: NOW });
    expect(claims.nonce.length).toBeGreaterThanOrEqual(16);
  });

  it("issues a fresh nonce every time", () => {
    const a = verifyOAuthState(createOAuthState(account, SECRET, NOW), SECRET, NOW);
    const b = verifyOAuthState(createOAuthState(account, SECRET, NOW), SECRET, NOW);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("rejects a state whose payload was edited (e.g. to another business)", () => {
    const [, sig] = createOAuthState(account, SECRET, NOW).split(".");
    const forged = Buffer.from(
      JSON.stringify({ businessId: 9999, userId: 1001, iat: NOW, nonce: "n".repeat(22) }),
    ).toString("base64url");
    expect(() => verifyOAuthState(`${forged}.${sig}`, SECRET, NOW)).toThrow(
      InvalidOAuthStateError,
    );
  });

  it("rejects a state signed with another secret", () => {
    const state = createOAuthState(account, "some-other-secret-of-sufficient-length", NOW);
    expect(() => verifyOAuthState(state, SECRET, NOW)).toThrow(/bad signature/);
  });

  it("rejects a correctly signed payload with malformed claims", () => {
    const payload = Buffer.from(JSON.stringify({ businessId: "2001" })).toString("base64url");
    const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(() => verifyOAuthState(`${payload}.${sig}`, SECRET, NOW)).toThrow(
      /malformed claims/,
    );
  });

  it("expires after ten minutes", () => {
    const state = createOAuthState(account, SECRET, NOW);
    expect(() =>
      verifyOAuthState(state, SECRET, NOW + OAUTH_STATE_TTL_MS - 1),
    ).not.toThrow();
    expect(() =>
      verifyOAuthState(state, SECRET, NOW + OAUTH_STATE_TTL_MS + 1),
    ).toThrow(/expired/);
  });

  it("rejects a state issued in the future beyond clock skew", () => {
    const state = createOAuthState(account, SECRET, NOW + 5 * 60 * 1000);
    expect(() => verifyOAuthState(state, SECRET, NOW)).toThrow(/future/);
  });

  it.each([
    undefined,
    "",
    "business_id_2001_user_id_1001",
    "a.b.c",
    "only-one-part.",
  ])("rejects malformed input %j", (state) => {
    expect(() => verifyOAuthState(state, SECRET, NOW)).toThrow(InvalidOAuthStateError);
  });

  it("maps to HTTP 403", () => {
    expect(new InvalidOAuthStateError("x").statusCode).toBe(403);
  });
});
