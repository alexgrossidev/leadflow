import type { whatsappNumberRemovedPayload } from "@leadflow/shared";
import { logger } from "@leadflow/shared";
import { sessionService } from "#modules/sessions/session.service";

export async function NUMBER_REMOVED(payload: whatsappNumberRemovedPayload): Promise<void> {
  try {
    await sessionService.closeSession(payload.businessId, payload.userId);
    logger.info(
      { businessId: payload.businessId, userId: payload.userId },
      "WhatsApp session closed for removed number",
    );
  } catch (err) {
    logger.error(
      { businessId: payload.businessId, userId: payload.userId, err },
      "Failed to close WhatsApp session for removed number",
    );
    throw err;
  }
}
