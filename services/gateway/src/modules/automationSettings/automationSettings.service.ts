import { eventNames } from "@leadflow/shared/eventBus";
import { emitToSender } from "#comms/bullmq/bullmq.eventEmitter";
import { AutomationSettingsBody, DEFAULT_SETTINGS } from "./automationSettings.schema.js";

/**
 * Sending limits are owned by the sender service; the gateway only validates
 * them and forwards the change. The emit is awaited so a failure reaches the
 * client instead of being silently dropped.
 */
export class AutomationSettingsService {
  async create(businessId: number, userId: number, payload: AutomationSettingsBody): Promise<void> {
    await emitToSender(eventNames.SENDER_AUTOM_SETTINGS_CREATED, {
      userId,
      businessId,
      settings: payload,
    });
  }

  async update(businessId: number, userId: number, payload: AutomationSettingsBody): Promise<void> {
    await emitToSender(eventNames.SENDER_AUTOM_SETTINGS_UPDATED, {
      userId,
      businessId,
      settings: payload,
    });
  }

  async delete(businessId: number, userId: number): Promise<void> {
    await emitToSender(eventNames.SENDER_AUTOM_SETTINGS_DELETED, {
      userId,
      businessId,
      settings: DEFAULT_SETTINGS,
    });
  }
}
