import { eq } from "drizzle-orm";
import { db } from "#core/db";
import { DEFAULT_OPENING_TIMES } from "#dispatchers/processor/limiter/limiter.types";
import { openingTimes, type OpeningDay } from "./openingTimes.table";

export class OpeningTimesRepository {
  /**
   * The business's weekly schedule. A business that never configured one gets
   * the default (Mon–Fri 09:00–13:00 / 14:00–18:00); days missing from a
   * configured schedule are closed.
   */
  async getWeek(businessId: number): Promise<OpeningDay[]> {
    const rows = await db.select().from(openingTimes).where(eq(openingTimes.businessId, businessId));
    return rows.length > 0 ? rows : DEFAULT_OPENING_TIMES;
  }
}
