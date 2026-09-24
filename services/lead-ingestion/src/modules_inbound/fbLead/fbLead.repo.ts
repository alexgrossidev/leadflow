import { and, eq, lte } from "drizzle-orm";
import { db } from "#database/pool";
import { dbOp } from "#database/errors";
import { withDbRetry } from "#database/resilient";
import { facebookLead, FacebookLead, FacebookLeadData } from "./fbLead.table";

export class FacebookLeadRepository {
  async getByLeadId(
    userId: number,
    leadId: string,
  ): Promise<FacebookLead | null> {
    const rows = await withDbRetry(
      () =>
        dbOp("facebook_lead.getByLeadId", () =>
          db
            .select()
            .from(facebookLead)
            .where(
              and(
                eq(facebookLead.userId, userId),
                eq(facebookLead.leadId, leadId),
              ),
            )
            .limit(1),
        ),
      { label: "facebook_lead.getByLeadId" },
    );
    return rows[0] ?? null;
  }

  /**
   * Leads captured but not delivered whose row has not moved since
   * `staleBefore`. The staleness filter keeps the reconciliation net off leads
   * a live job is still working on.
   */
  async findUndelivered(
    userId: number,
    staleBefore: Date,
    limit = 500,
  ): Promise<FacebookLead[]> {
    return dbOp("facebook_lead.findUndelivered", () =>
      db
        .select()
        .from(facebookLead)
        .where(
          and(
            eq(facebookLead.userId, userId),
            eq(facebookLead.delivered, false),
            lte(facebookLead.updatedAt, staleBefore),
          ),
        )
        .limit(limit),
    );
  }

  /** Insert or advance the lead's row (unique on user_id + lead_id). */
  async upsert(data: FacebookLeadData): Promise<void> {
    await dbOp("facebook_lead.upsert", () =>
      db
        .insert(facebookLead)
        .values(data)
        .onDuplicateKeyUpdate({
          set: {
            fetched: data.fetched,
            delivered: data.delivered,
            rawResponse: data.rawResponse,
            cleanResponse: data.cleanResponse,
          },
        }),
    );
  }
}
