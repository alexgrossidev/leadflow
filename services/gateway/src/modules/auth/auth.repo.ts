import { and, eq, isNull, or } from "drizzle-orm";
import { mainDb } from "#database/mainPool";
import {
  NewRefreshToken,
  RefreshTokenRecord,
  User,
  refreshTokens,
  users,
} from "./auth.table.js";

/** Persistence the auth flow needs; an interface so tests can use an in-memory store. */
export interface AuthStore {
  findUserByUsernameOrEmail(identifier: string): Promise<User | null>;
  insertRefreshToken(token: NewRefreshToken): Promise<void>;
  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /**
   * Atomically revokes `currentId` and stores its successor. Resolves false when
   * `currentId` was already revoked (a concurrent refresh won the race).
   */
  rotateRefreshToken(currentId: number, next: NewRefreshToken): Promise<boolean>;
  revokeFamily(familyId: string): Promise<void>;
}

export class AuthRepository implements AuthStore {
  async findUserByUsernameOrEmail(identifier: string): Promise<User | null> {
    const [user] = await mainDb
      .select()
      .from(users)
      .where(or(eq(users.username, identifier), eq(users.email, identifier)))
      .limit(1);
    return user ?? null;
  }

  async insertRefreshToken(token: NewRefreshToken): Promise<void> {
    await mainDb.insert(refreshTokens).values(token);
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const [row] = await mainDb
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return row ?? null;
  }

  async rotateRefreshToken(currentId: number, next: NewRefreshToken): Promise<boolean> {
    return mainDb.transaction(async (tx) => {
      // The `revoked_at IS NULL` predicate makes this a compare-and-set: only
      // one of two concurrent refreshes with the same token can win.
      const [result] = await tx
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(and(eq(refreshTokens.id, currentId), isNull(refreshTokens.revokedAt)));
      if (result.affectedRows !== 1) return false;

      await tx.insert(refreshTokens).values(next);
      return true;
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await mainDb
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}
