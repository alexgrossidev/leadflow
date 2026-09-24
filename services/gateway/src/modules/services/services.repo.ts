import { eq } from "drizzle-orm";
import { mainDb } from "#database/mainPool";
import { BusinessService, services } from "./services.table.js";

export class BusinessServiceRepository {
  async listForBusiness(businessId: number): Promise<BusinessService[]> {
    return mainDb.select().from(services).where(eq(services.businessId, businessId));
  }
}
