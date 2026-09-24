import { eq } from "drizzle-orm";
import { db } from "#core/db";
import { settings, type NewSettings, type Settings } from "./settings.table";

export class SettingsRepository {
  /** The timezone is not part of the settings event, so an update never resets it. */
  async upsert(data: NewSettings): Promise<void> {
    await db
      .insert(settings)
      .values(data)
      .onDuplicateKeyUpdate({
        set: {
          validateForBusinessHours: data.validateForBusinessHours,
          inWarmUpMode: data.inWarmUpMode,
          maxEmails: data.maxEmails,
          maxWhatsapps: data.maxWhatsapps,
          toleranceRate: data.toleranceRate,
          minimumWaitBetweenMessages: data.minimumWaitBetweenMessages,
        },
      });
  }

  async deleteByBusinessId(businessId: number): Promise<void> {
    await db.delete(settings).where(eq(settings.businessId, businessId));
  }

  async findByBusinessId(businessId: number): Promise<Settings | null> {
    const [row] = await db.select().from(settings).where(eq(settings.businessId, businessId)).limit(1);
    return row ?? null;
  }
}
