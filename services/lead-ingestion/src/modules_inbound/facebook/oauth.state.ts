import crypto from "crypto";

/**
 * Signed OAuth `state` for the Facebook connect flow.
 *
 * The callback trusts `state` to say which (business, user) the returned code
 * belongs to. Unsigned, anyone could craft a callback URL that links their own
 * Facebook page to someone else's business (login/account-linking CSRF), so
 * the state is `base64url(payload).base64url(hmac)`, issued only by the
 * service-token-guarded /fb/connect, valid for ten minutes, and carrying a
 * random nonce the callback burns on first use.
 */

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Tolerated clock drift between replicas for the issued-at check. */
const CLOCK_SKEW_MS = 60 * 1000;

export interface OAuthStateClaims {
  businessId: number;
  userId: number;
  /** Issued-at, epoch ms. */
  iat: number;
  /** 128-bit random, base64url; single-use. */
  nonce: string;
}

export class InvalidOAuthStateError extends Error {
  readonly statusCode = 403;
  constructor(reason: string) {
    super(`Invalid OAuth state: ${reason}`);
    this.name = "InvalidOAuthStateError";
  }
}

const sign = (payload: string, secret: string): Buffer =>
  crypto.createHmac("sha256", secret).update(payload).digest();

export function createOAuthState(
  account: { businessId: number; userId: number },
  secret: string,
  now: number = Date.now(),
): string {
  const claims: OAuthStateClaims = {
    businessId: account.businessId,
    userId: account.userId,
    iat: now,
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload, secret).toString("base64url")}`;
}

const isPositiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/**
 * Verify signature (timing-safe) and freshness, then return the claims.
 * Throws {@link InvalidOAuthStateError} on any failure; the caller must still
 * burn `nonce` to make the state single-use.
 */
export function verifyOAuthState(
  state: unknown,
  secret: string,
  now: number = Date.now(),
  ttlMs: number = OAUTH_STATE_TTL_MS,
): OAuthStateClaims {
  if (typeof state !== "string" || state.length > 1024) {
    throw new InvalidOAuthStateError("missing");
  }
  const [payload, signature, extra] = state.split(".");
  if (!payload || !signature || extra !== undefined) {
    throw new InvalidOAuthStateError("malformed");
  }

  const expected = sign(payload, secret);
  const received = Buffer.from(signature, "base64url");
  if (
    received.length !== expected.length ||
    !crypto.timingSafeEqual(received, expected)
  ) {
    throw new InvalidOAuthStateError("bad signature");
  }

  let claims: Partial<OAuthStateClaims>;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new InvalidOAuthStateError("malformed payload");
  }

  if (
    !isPositiveInt(claims.businessId) ||
    !isPositiveInt(claims.userId) ||
    typeof claims.iat !== "number" ||
    typeof claims.nonce !== "string" ||
    claims.nonce.length < 16
  ) {
    throw new InvalidOAuthStateError("malformed claims");
  }
  if (claims.iat > now + CLOCK_SKEW_MS) {
    throw new InvalidOAuthStateError("issued in the future");
  }
  if (now - claims.iat > ttlMs) {
    throw new InvalidOAuthStateError("expired");
  }

  return claims as OAuthStateClaims;
}
