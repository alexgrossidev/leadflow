import { senderAutomSettingsPayload } from "@leadflow/shared";
import { logger } from "@leadflow/shared";
import { settingsService } from "#modules/settings/settings.module";

export async function SETTINGS_DELETE(payload: senderAutomSettingsPayload): Promise<void> {
  try {
    await settingsService.delete(payload.businessId);
    logger.info({ businessId: payload.businessId }, "Settings deleted successfully");
  } catch (err) {
    logger.error({ businessId: payload.businessId, err }, "Failed to delete settings");
    throw err;
  }
}
