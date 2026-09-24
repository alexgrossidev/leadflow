import {
  EventPayloadMap,
  getEventEmitter,
  serviceNames,
  type EmitOptions,
} from "@leadflow/shared/eventBus";

// Payloads are never logged here or in the shared bus: they carry PII.

export function emitToAutomations<T extends keyof EventPayloadMap>(
  eventName: T,
  payload: EventPayloadMap[T],
  options?: EmitOptions,
): Promise<string> {
  return getEventEmitter().emit(serviceNames.AUTOMATIONS, eventName, payload, options);
}

export function emitToSender<T extends keyof EventPayloadMap>(
  eventName: T,
  payload: EventPayloadMap[T],
  options?: EmitOptions,
): Promise<string> {
  return getEventEmitter().emit(serviceNames.SENDER, eventName, payload, options);
}

export function emitToWhatsapp<T extends keyof EventPayloadMap>(
  eventName: T,
  payload: EventPayloadMap[T],
  options?: EmitOptions,
): Promise<string> {
  return getEventEmitter().emit(serviceNames.WHATSAPP, eventName, payload, options);
}
