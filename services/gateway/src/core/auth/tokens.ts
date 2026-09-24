import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "crypto";
import { env } from "#config/env";
import {
  AccessTokenExpiredError,
  AccessTokenInvalidError,
} from "./auth.errors.js";
import { AccessTokenClaims, AuthenticatedUser } from "./auth.types.js";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Pinned on both sign and verify, so a token signed with "none" or with an
// asymmetric algorithm confusion trick is rejected outright.
const ALGORITHM = "HS256" as const;

export function signAccessToken(userId: number): string {
  return jwt.sign({}, env.JWT_SECRET, {
    subject: String(userId),
    algorithm: ALGORITHM,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function verifyAccessToken(token: string): AuthenticatedUser {
  let claims: AccessTokenClaims;
  try {
    claims = jwt.verify(token, env.JWT_SECRET, {
      algorithms: [ALGORITHM],
    }) as AccessTokenClaims;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) throw new AccessTokenExpiredError();
    throw new AccessTokenInvalidError();
  }

  const userId = Number(claims.sub);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new AccessTokenInvalidError();
  }
  return { userId };
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Refresh tokens are opaque random strings, not JWTs: they carry no claims, so
 * there is nothing to leak or forge, and revocation is a database lookup.
 */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Only this digest is stored, so a database leak does not yield usable tokens. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
