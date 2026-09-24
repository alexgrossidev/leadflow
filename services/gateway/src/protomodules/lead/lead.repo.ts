import { SQL, and, asc, eq, gt } from "drizzle-orm";
import { mainDb } from "#database/mainPool";
import { leads } from "../../modules/lead/lead.table.js";
import { businesses } from "../../modules/business/business.table.js";

export interface LeadStreamRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
}

export class LeadStreamRepository {
  async businessBelongsToUser(businessId: number, userId: number): Promise<boolean> {
    const [row] = await mainDb
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.userId, userId)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Yields the business's matching leads in pages of `batchSize`, using keyset
   * pagination (`id > lastSeenId`): every page is an index range scan, and
   * memory stays bounded by one page no matter how many leads match.
   */
  async *pages(
    businessId: number,
    condition: SQL | undefined,
    batchSize: number,
  ): AsyncGenerator<LeadStreamRow[]> {
    let lastSeenId = 0;
    for (;;) {
      const page = await mainDb
        .select({
          id: leads.id,
          name: leads.name,
          email: leads.email,
          phone: leads.phone,
          status: leads.status,
        })
        .from(leads)
        .where(and(eq(leads.businessId, businessId), gt(leads.id, lastSeenId), condition))
        .orderBy(asc(leads.id))
        .limit(batchSize);

      if (page.length === 0) return;
      yield page;
      if (page.length < batchSize) return;
      lastSeenId = page[page.length - 1]!.id;
    }
  }
}
