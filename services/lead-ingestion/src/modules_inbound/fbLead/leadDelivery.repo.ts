import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "#database/pool";
import { dbOp, isDuplicateKey } from "#database/errors";
import { leadDelivery } from "./leadDelivery.table";

export type DeliveryClaim = "CLAIMED" | "ALREADY_DELIVERED" | "IN_PROGRESS";

/** The guard surface the delivery client depends on (injectable for tests). */
export interface DeliveryGuard {
  claim(userId: number, leadId: string, staleBefore: Date): Promise<DeliveryClaim>;
  markDelivered(userId: number, leadId: string, response: unknown): Promise<void>;
  release(userId: number, leadId: string): Promise<void>;
}

const byLead = (userId: number, leadId: string) =>
  and(eq(leadDelivery.userId, userId), eq(leadDelivery.leadId, leadId));

/**
 * Serialises delivery of one lead. Each method is atomic on its own (the unique
 * constraint serialises first-time claims and the conditional UPDATE serialises
 * stale reclaims), so no surrounding transaction is needed.
 */
export class LeadDeliveryRepository implements DeliveryGuard {
  /**
   * Claim the right to deliver (userId, leadId): CLAIMED means safe to send,
   * ALREADY_DELIVERED means a prior attempt succeeded, IN_PROGRESS means a fresh
   * claim is held elsewhere. An IN_FLIGHT claim older than `staleBefore` can be
   * reclaimed, so a crashed attempt never strands the lead.
   */
  async claim(
    userId: number,
    leadId: string,
    staleBefore: Date,
  ): Promise<DeliveryClaim> {
    try {
      await dbOp("lead_delivery.claim.insert", () =>
        db.insert(leadDelivery).values({ userId, leadId }),
      );
      return "CLAIMED";
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
    }

    const [row] = await dbOp("lead_delivery.claim.read", () =>
      db
        .select({ status: leadDelivery.status })
        .from(leadDelivery)
        .where(byLead(userId, leadId))
        .limit(1),
    );

    if (!row) return "IN_PROGRESS"; // released concurrently; a retry re-claims
    if (row.status === "DELIVERED") return "ALREADY_DELIVERED";

    // Reclaim only a stale claim. The predicate plus the row lock make exactly
    // one concurrent reclaimer win; attempts++ guarantees a real row change so
    // affectedRows reliably reports the winner.
    const [res] = await dbOp("lead_delivery.claim.reclaim", () =>
      db
        .update(leadDelivery)
        .set({
          attempts: sql`${leadDelivery.attempts} + 1`,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(
          and(
            byLead(userId, leadId),
            eq(leadDelivery.status, "IN_FLIGHT"),
            lte(leadDelivery.updatedAt, staleBefore),
          ),
        ),
    );

    return res.affectedRows === 1 ? "CLAIMED" : "IN_PROGRESS";
  }

  /** Promote a claim to DELIVERED, recording the gateway's reply. */
  async markDelivered(
    userId: number,
    leadId: string,
    response: unknown,
  ): Promise<void> {
    await dbOp("lead_delivery.markDelivered", () =>
      db
        .update(leadDelivery)
        .set({ status: "DELIVERED", deliveryResponse: response })
        .where(byLead(userId, leadId)),
    );
  }

  /** Drop a failed claim so a retry can re-deliver; never removes a delivered row. */
  async release(userId: number, leadId: string): Promise<void> {
    await dbOp("lead_delivery.release", () =>
      db
        .delete(leadDelivery)
        .where(and(byLead(userId, leadId), eq(leadDelivery.status, "IN_FLIGHT"))),
    );
  }
}
