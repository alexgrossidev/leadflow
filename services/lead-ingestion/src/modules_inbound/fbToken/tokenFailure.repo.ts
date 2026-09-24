import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#database/pool";
import { dbOp } from "#database/errors";
import {
  facebookTokenFailure,
  FacebookTokenFailure,
} from "./tokenFailure.table";

export interface RecordFailureInput {
  userId: number;
  businessId: number;
  pageId?: string | null;
  reason: string;
  lastError?: string | null;
}

const openFor = (userId: number, businessId: number) =>
  and(
    eq(facebookTokenFailure.userId, userId),
    eq(facebookTokenFailure.businessId, businessId),
    isNull(facebookTokenFailure.resolvedAt),
  );

export class FacebookTokenFailureRepository {
  /**
   * Open (or re-open) the dead-letter row for an account. Idempotent per
   * (user, business): a repeat failure bumps `attempts` and clears any prior
   * resolution, so the same account never spawns duplicate rows.
   */
  async recordFailure(input: RecordFailureInput): Promise<void> {
    await dbOp("facebook_token_failure.record", () =>
      db
        .insert(facebookTokenFailure)
        .values({
          userId: input.userId,
          businessId: input.businessId,
          pageId: input.pageId ?? null,
          reason: input.reason,
          lastError: input.lastError ?? null,
        })
        .onDuplicateKeyUpdate({
          set: {
            pageId: input.pageId ?? null,
            reason: input.reason,
            lastError: input.lastError ?? null,
            attempts: sql`${facebookTokenFailure.attempts} + 1`,
            resolvedAt: sql`NULL`,
          },
        }),
    );
  }

  /** The currently open (unresolved) failure for an account, if any. */
  async findActive(
    userId: number,
    businessId: number,
  ): Promise<FacebookTokenFailure | null> {
    const rows = await dbOp("facebook_token_failure.findActive", () =>
      db
        .select()
        .from(facebookTokenFailure)
        .where(openFor(userId, businessId))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  /** Record that the reconnect prompt was emitted (prevents re-notifying). */
  async markNotified(userId: number, businessId: number): Promise<void> {
    await dbOp("facebook_token_failure.markNotified", () =>
      db
        .update(facebookTokenFailure)
        .set({ notifiedAt: sql`CURRENT_TIMESTAMP` })
        .where(openFor(userId, businessId)),
    );
  }

  /** Close the dead-letter row once the account heals or reconnects. */
  async markResolved(userId: number, businessId: number): Promise<void> {
    await dbOp("facebook_token_failure.markResolved", () =>
      db
        .update(facebookTokenFailure)
        .set({ resolvedAt: sql`CURRENT_TIMESTAMP` })
        .where(openFor(userId, businessId)),
    );
  }
}
