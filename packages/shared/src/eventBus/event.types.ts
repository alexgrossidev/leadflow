import {
  automationCreatedPayload,
  automationUpdatedPayload,
  automationDeletedPayload,
  automationPausedPayload,
  senderAutomSettingsPayload,
  senderDeliverToWhatsappPayload,
  whatsappNumberAddedPayload,
  whatsappNumberRemovedPayload,
  LeadCreatedPayload,
} from "./event.contracts";


export const serviceNames = {
  API_GATEWAY: "api-gateway",
  LEAD_INGESTION: "lead-ingestion",
  AUTOMATIONS: "automations",
  SENDER: "sender",
  WHATSAPP: "whatsapp",
} as const;

export type serviceName = (typeof serviceNames)[keyof typeof serviceNames];

// Event names are namespaced by the domain that owns the payload.

export const eventNames = {
  AUTOMATION_CREATED: "automation.created",
  AUTOMATION_UPDATED: "automation.updated",
  AUTOMATION_DELETED: "automation.deleted",
  AUTOMATION_PAUSED: "automation.paused",

  // Lead lifecycle (owned by the gateway)
  LEAD_CREATED: "lead.created",

  //Sender events
  SENDER_AUTOM_SETTINGS_CREATED: "sender.autom_settings.created",
  SENDER_AUTOM_SETTINGS_UPDATED: "sender.autom_settings.updated",
  SENDER_AUTOM_SETTINGS_DELETED: "sender.autom_settings.deleted",

  //Whatsapp
  WHATSAPP_REQUEST_CREATED: "whatsapp.message.created",
  WHATSAPP_NUMBER_ADDED: "whatsapp.number.added",
  WHATSAPP_NUMBER_REMOVED: "whatsapp.number.removed",

} as const;

export type eventName = (typeof eventNames)[keyof typeof eventNames];

export interface EventPayloadMap {
  [eventNames.AUTOMATION_CREATED]: automationCreatedPayload;
  [eventNames.AUTOMATION_UPDATED]: automationUpdatedPayload;
  [eventNames.AUTOMATION_DELETED]: automationDeletedPayload;
  [eventNames.AUTOMATION_PAUSED]: automationPausedPayload;

  [eventNames.LEAD_CREATED]: LeadCreatedPayload;

  [eventNames.SENDER_AUTOM_SETTINGS_CREATED]: senderAutomSettingsPayload;
  [eventNames.SENDER_AUTOM_SETTINGS_UPDATED]: senderAutomSettingsPayload;
  [eventNames.SENDER_AUTOM_SETTINGS_DELETED]: senderAutomSettingsPayload;

  [eventNames.WHATSAPP_REQUEST_CREATED]: senderDeliverToWhatsappPayload;
  [eventNames.WHATSAPP_NUMBER_ADDED]: whatsappNumberAddedPayload;
  [eventNames.WHATSAPP_NUMBER_REMOVED]: whatsappNumberRemovedPayload;

}
