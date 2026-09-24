import { senderAutomSettingsPayload } from "@leadflow/shared";
import { logger } from "@leadflow/shared";
import { settingsService } from "#modules/settings/settings.module";

export async function SETTINGS_UPSERT(payload: senderAutomSettingsPayload): Promise<void> {
  try {
    await settingsService.upsert(payload);
    logger.info({ businessId: payload.businessId }, "Settings upserted successfully");
  } catch (err) {
    logger.error({ businessId: payload.businessId, err }, "Failed to upsert settings");
    throw err;
  }
}
