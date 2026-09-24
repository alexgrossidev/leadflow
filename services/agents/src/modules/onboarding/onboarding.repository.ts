import { and, eq, sql } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type { OnboardingResult } from "#dispatchers/onboarding/types";
import { onboardingRequests, type OnboardingRequestRecord } from "./onboarding.table.js";

export type BeginOutcome =
  | { started: true }
  | { started: false; existing: OnboardingRequestRecord };

/** Persistence port for onboarding idempotency records. */
export interface IdempotencyStore {
  /**
   * Claims the key atomically. `started: true` means this caller owns the run;
   * otherwise the existing record is returned for the caller to replay or refuse.
   */
  begin(userId: string, key: string, requestHash: string): Promise<BeginOutcome>;
  complete(userId: string, key: string, result: OnboardingResult): Promise<void>;
  fail(userId: string, key: string): Promise<void>;
}

export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(private readonly database: MySql2Database) {}

  async begin(userId: string, key: string, requestHash: string): Promise<BeginOutcome> {
    // Insert-or-no-op: MySQL reports 1 affected row for a fresh insert and 0
    // when the key already existed and the no-op update changed nothing, so
    // the claim is a single atomic statement with no race window.
    const [result] = await this.database
      .insert(onboardingRequests)
      .values({ userId, idempotencyKey: key, requestHash, status: "in_progress" })
      .onDuplicateKeyUpdate({ set: { userId: sql`${onboardingRequests.userId}` } });
    if (result.affectedRows === 1) return { started: true };

    const [existing] = await this.database
      .select()
      .from(onboardingRequests)
      .where(this.byKey(userId, key))
      .limit(1);
    if (!existing) throw new Error("Idempotency record vanished after conflict");
    return { started: false, existing };
  }

  async complete(userId: string, key: string, result: OnboardingResult): Promise<void> {
    await this.database
      .update(onboardingRequests)
      .set({ status: "completed", result })
      .where(this.byKey(userId, key));
  }

  async fail(userId: string, key: string): Promise<void> {
    await this.database
      .update(onboardingRequests)
      .set({ status: "failed" })
      .where(this.byKey(userId, key));
  }

  private byKey(userId: string, key: string) {
    return and(
      eq(onboardingRequests.userId, userId),
      eq(onboardingRequests.idempotencyKey, key),
    );
  }
}
