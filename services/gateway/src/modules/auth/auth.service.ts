import bcrypt from "bcrypt";
import { randomUUID } from "crypto";
import { logger } from "#core/logger";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "#core/auth/tokens";
import { AuthStore } from "./auth.repo.js";
import { LoginRateLimiter } from "./login-rate-limit.js";
import {
  InvalidCredentialsError,
  LoginRateLimitedError,
  RefreshTokenInvalidError,
  RefreshTokenReusedError,
} from "./auth.errors.js";

export interface Session {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

// Compared against when the user does not exist, so an unknown username costs
// the same bcrypt work as a wrong password and response timing leaks nothing.
const DUMMY_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8.Wnnb5/jyDaXbWiS1gGnCmPxRkyW.";

/** Legacy PHP hashes use the $2y$ prefix; same algorithm as Node's $2b$. */
function normalizeBcryptHash(hash: string): string {
  return hash.replace(/^\$2y\$/, "$2b$");
}

export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly rateLimiter: LoginRateLimiter,
  ) {}

  async login(username: string, password: string, ip: string): Promise<Session> {
    if (!(await this.rateLimiter.attempt(ip, username))) {
      logger.warn({ ip }, "Login rate limit exceeded");
      throw new LoginRateLimitedError();
    }

    const user = await this.store.findUserByUsernameOrEmail(username);
    const valid = await bcrypt.compare(
      password,
      normalizeBcryptHash(user?.passwordHash ?? DUMMY_HASH),
    );

    if (!user || !user.passwordHash || !valid) {
      logger.info({ ip }, "Login failed");
      throw new InvalidCredentialsError();
    }

    await this.rateLimiter.clear(ip, username);
    logger.info({ userId: user.id }, "Login succeeded");
    return this.issueSession(user.id, randomUUID());
  }

  /**
   * Rotates a refresh token. Every refresh token is single-use: presenting one
   * that was already rotated means it leaked, so its whole family is revoked
   * and the legitimate user has to sign in again.
   */
  async refresh(presentedToken: string | undefined): Promise<Session> {
    if (!presentedToken) throw new RefreshTokenInvalidError();

    const record = await this.store.findRefreshToken(hashRefreshToken(presentedToken));
    if (!record) throw new RefreshTokenInvalidError();

    if (record.revokedAt) {
      await this.store.revokeFamily(record.familyId);
      logger.warn(
        { userId: record.userId, familyId: record.familyId },
        "Refresh token reuse detected; family revoked",
      );
      throw new RefreshTokenReusedError();
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new RefreshTokenInvalidError();
    }

    const refreshToken = generateRefreshToken();
    const rotated = await this.store.rotateRefreshToken(record.id, {
      userId: record.userId,
      familyId: record.familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    if (!rotated) {
      // Lost a race against another refresh with the same token: treat as reuse.
      await this.store.revokeFamily(record.familyId);
      throw new RefreshTokenReusedError();
    }

    return {
      accessToken: signAccessToken(record.userId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
    };
  }

  /** Ends the session the token belongs to. Unknown tokens are a silent no-op. */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    const record = await this.store.findRefreshToken(hashRefreshToken(presentedToken));
    if (record) await this.store.revokeFamily(record.familyId);
  }

  private async issueSession(userId: number, familyId: string): Promise<Session> {
    const refreshToken = generateRefreshToken();
    await this.store.insertRefreshToken({
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    return {
      accessToken: signAccessToken(userId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken,
    };
  }
}
