import { and, eq } from "drizzle-orm";
import { DbExecutor, mainDb } from "#database/mainPool";
import { businesses } from "../business/business.table.js";
import { Lead, LeadSource, NewLead, leads } from "./lead.table.js";

export class LeadRepository {
  async insert(data: NewLead, db: DbExecutor = mainDb): Promise<number> {
    const [result] = await db.insert(leads).values(data);
    return result.insertId;
  }

  async findById(id: number, businessId: number): Promise<Lead | null> {
    const [row] = await mainDb
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.businessId, businessId)))
      .limit(1);
    return row ?? null;
  }

  async findByExternalId(
    businessId: number,
    source: LeadSource,
    externalId: string,
  ): Promise<Lead | null> {
    const [row] = await mainDb
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.businessId, businessId),
          eq(leads.source, source),
          eq(leads.externalId, externalId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Scoped by business: a lead id from another tenant matches nothing. */
  async update(id: number, businessId: number, data: Partial<NewLead>): Promise<boolean> {
    const [result] = await mainDb
      .update(leads)
      .set(data)
      .where(and(eq(leads.id, id), eq(leads.businessId, businessId)));
    return result.affectedRows > 0;
  }

  async markEventEmitted(id: number): Promise<void> {
    await mainDb.update(leads).set({ eventEmittedAt: new Date() }).where(eq(leads.id, id));
  }

  async businessBelongsToUser(businessId: number, userId: number): Promise<boolean> {
    const [row] = await mainDb
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
      .limit(1);
    return Boolean(row);
  }
}
