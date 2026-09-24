import type { whatsappNumberAddedPayload } from "@leadflow/shared";
import { logger } from "@leadflow/shared";
import { sessionService } from "#modules/sessions/session.service";

export async function NUMBER_ADDED(payload: whatsappNumberAddedPayload): Promise<void> {
  try {
    await sessionService.initSession(payload.businessId, payload.userId);
    logger.info(
      { businessId: payload.businessId, userId: payload.userId },
      "WhatsApp session initiated for new number",
    );
  } catch (err) {
    logger.error(
      { businessId: payload.businessId, userId: payload.userId, err },
      "Failed to initiate WhatsApp session for new number",
    );
    throw err;
  }
}
