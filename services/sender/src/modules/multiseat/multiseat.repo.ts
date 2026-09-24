import { eq } from "drizzle-orm";
import { db } from "#core/db";
import { multiseatSettings } from "./multiseat.table";

export class MultiseatRepository {
  /** Businesses without a row have multiseat disabled. */
  async isEnabled(businessId: number): Promise<boolean> {
    const [row] = await db
      .select({ enabled: multiseatSettings.enabled })
      .from(multiseatSettings)
      .where(eq(multiseatSettings.businessId, businessId))
      .limit(1);
    return row?.enabled ?? false;
  }
}
