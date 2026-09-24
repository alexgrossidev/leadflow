import { and, eq } from "drizzle-orm";
import { db } from "#database/pool";
import { dbOp } from "#database/errors";
import { withDbRetry } from "#database/resilient";
import {
  FacebookToken,
  facebookToken,
  FacebookTokenUserData,
} from "./fbToken.table";

/** A connected account is identified by (user, business); a user may own several businesses. */
const byAccount = (userId: number, businessId: number) =>
  and(
    eq(facebookToken.userId, userId),
    eq(facebookToken.businessId, businessId),
  );

export class FacebookTokenRepository {
  /**
   * Insert or update the account's row (unique on user_id + business_id).
   * Fields left `undefined` are not touched on update, so a caller can advance
   * one piece of state without re-supplying the others.
   */
  async upsert(data: FacebookTokenUserData): Promise<void> {
    await dbOp("facebook_token.upsert", () =>
      db
        .insert(facebookToken)
        .values({ ...data, fbPageId: data.fbPageId ?? null })
        .onDuplicateKeyUpdate({
          set: {
            token: data.token,
            tokenType: data.tokenType,
            expiresAt: data.expiresAt,
            refreshToken: data.refreshToken,
            subscribed: data.subscribed,
            valid: data.valid,
            fbPageId: data.fbPageId,
            oauthCodeHash: data.oauthCodeHash,
          },
        }),
    );
  }

  async findByAccount(
    userId: number,
    businessId: number,
  ): Promise<FacebookToken | null> {
    const rows = await withDbRetry(
      () =>
        dbOp("facebook_token.findByAccount", () =>
          db
            .select()
            .from(facebookToken)
            .where(byAccount(userId, businessId))
            .limit(1),
        ),
      { label: "facebook_token.findByAccount" },
    );
    return rows[0] ?? null;
  }

  /** Resolve the owning account and token from a Facebook page id (webhook input). */
  async findByFbPageId(pageId: string): Promise<FacebookToken | null> {
    const rows = await withDbRetry(
      () =>
        dbOp("facebook_token.findByFbPageId", () =>
          db
            .select()
            .from(facebookToken)
            .where(eq(facebookToken.fbPageId, pageId))
            .limit(1),
        ),
      { label: "facebook_token.findByFbPageId" },
    );
    return rows[0] ?? null;
  }

  /** Advance the reconciliation high-water mark after a successful sync pass. */
  async touchLastSynced(
    userId: number,
    businessId: number,
    when: Date,
  ): Promise<void> {
    await dbOp("facebook_token.touchLastSynced", () =>
      db
        .update(facebookToken)
        .set({ lastSyncedAt: when })
        .where(byAccount(userId, businessId)),
    );
  }
}
