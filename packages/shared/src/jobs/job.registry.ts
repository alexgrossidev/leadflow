import type {
  LargeImportPayload,
  CompleteImportWithSettingsPayload,
  ImportResultReportPayload,
  FacebookLeadProcessPayload,
  FacebookPeriodicSyncPayload,
  FacebookExchangeTokenPayload,
  FacebookCheckSubscriptionPayload,
  FacebookRefreshTokenPayload,
  FacebookTokenRevokedPayload,
  GoogleLeadProcessPayload,
  AutomationExecuteInternalPayload,
  AutomationExecuteExternalPayload,
  AutomationUnpausePayload,
  SenderProcessPayload,
  WhatsappProcessPayload,
  CleanupPayload,
} from "./contracts";

/**
 * Every job in the system. The value is the BullMQ queue name, namespaced by
 * the service that owns the work; `JobPayloadMap` below binds each one to its
 * payload type, which `TypedQueueClient` enforces for producers and consumers.
 */
export const JobNames = {
  // fileparser: stage an upload, deliver staged rows, report the outcome to the gateway
  HEAVY_PROCESSES_IMPORT: "fileparser.bulk.import",
  HEAVY_PROCESSES_COMPLETE: "fileparser.import.settings",
  HEAVY_PROCESSES_RESULT: "fileparser.import.result",

  // lead-ingestion: Meta lead capture and the page-token lifecycle
  FACEBOOK_LEAD_PROCESS: "facebook.lead.process",
  FACEBOOK_PERIODIC_SYNC: "facebook.periodic.sync",
  FACEBOOK_EXCHANGE_TOKEN: "facebook.exchange.token",
  FACEBOOK_CHECK_SUBSCRIPTION: "facebook.check.subscription",
  FACEBOOK_REFRESH_TOKEN: "facebook.refresh.token",
  /** Tells the product to prompt the user to reconnect; not consumed in this repo yet. */
  FACEBOOK_TOKEN_REVOKED: "facebook.token.revoked",

  // lead-ingestion: Google Forms capture
  GOOGLE_LEAD_PROCESS: "google.lead.process",

  // automations: per-target execution, hand-off to the sender, resume after pause
  AUTOMATION_EXECUTE_INTERNAL: "automation.execute.internal",
  AUTOMATION_EXECUTE_EXTERNAL: "automation.execute.external",
  AUTOMATION_UNPAUSE: "automation.trigger.unpause",
  CLEANUP: "cleanup",

  // sender: the message step machine
  SENDER_PROCESS: "sender.process",

  // whatsapp: send one message on a tenant's session
  WHATSAPP_PROCESS: "whatsapp.process",
} as const;

export type JobName = (typeof JobNames)[keyof typeof JobNames];

export interface JobPayloadMap {
  [JobNames.HEAVY_PROCESSES_IMPORT]: LargeImportPayload;
  [JobNames.HEAVY_PROCESSES_COMPLETE]: CompleteImportWithSettingsPayload;
  [JobNames.HEAVY_PROCESSES_RESULT]: ImportResultReportPayload;

  [JobNames.FACEBOOK_LEAD_PROCESS]: FacebookLeadProcessPayload;
  [JobNames.FACEBOOK_PERIODIC_SYNC]: FacebookPeriodicSyncPayload;
  [JobNames.FACEBOOK_EXCHANGE_TOKEN]: FacebookExchangeTokenPayload;
  [JobNames.FACEBOOK_CHECK_SUBSCRIPTION]: FacebookCheckSubscriptionPayload;
  [JobNames.FACEBOOK_REFRESH_TOKEN]: FacebookRefreshTokenPayload;
  [JobNames.FACEBOOK_TOKEN_REVOKED]: FacebookTokenRevokedPayload;

  [JobNames.GOOGLE_LEAD_PROCESS]: GoogleLeadProcessPayload;

  [JobNames.AUTOMATION_EXECUTE_INTERNAL]: AutomationExecuteInternalPayload;
  [JobNames.AUTOMATION_EXECUTE_EXTERNAL]: AutomationExecuteExternalPayload;
  [JobNames.AUTOMATION_UNPAUSE]: AutomationUnpausePayload;
  [JobNames.CLEANUP]: CleanupPayload;

  [JobNames.SENDER_PROCESS]: SenderProcessPayload;

  [JobNames.WHATSAPP_PROCESS]: WhatsappProcessPayload;
}
