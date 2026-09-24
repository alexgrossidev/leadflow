import { eventNames, getEventEmitter, serviceNames } from "@leadflow/shared/eventBus";
import { logger } from "@leadflow/shared";
import { SETTINGS_UPSERT } from "#dispatchers/automationSettings/settings.UPSERT";
import { SETTINGS_DELETE } from "#dispatchers/automationSettings/settings.DELETE";

export function subscribeToEvents(): void {
  const emitter = getEventEmitter();
  emitter.subscribe(serviceNames.SENDER, eventNames.SENDER_AUTOM_SETTINGS_CREATED, SETTINGS_UPSERT);
  emitter.subscribe(serviceNames.SENDER, eventNames.SENDER_AUTOM_SETTINGS_UPDATED, SETTINGS_UPSERT);
  emitter.subscribe(serviceNames.SENDER, eventNames.SENDER_AUTOM_SETTINGS_DELETED, SETTINGS_DELETE);
  logger.info({ service: serviceNames.SENDER }, "Subscribed to settings events");
}
