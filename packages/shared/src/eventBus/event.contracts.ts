export interface automationCreatedPayload {
  userId: number;
  automation: any;
}

export interface automationUpdatedPayload {
  userId: number;
  automation: any;
}

export interface automationDeletedPayload {
  userId: number;
  automationId: number;
  businessId: number;
}

export interface automationPausedPayload {
  userId: number;
  businessId: number;
  automationId: number;
  paused: boolean;
}

export interface senderAutomSettingsPayload {
  userId: number;
  businessId: number;
  settings: {
    validateForBusinessHours: boolean;
    inWarmUpMode: boolean;
    maxEmails: number;
    maxWhatsapps: number;
    toleranceRate: number;
    minimumWaitBetweenMessages: number;
  };
}

export interface whatsappNumberAddedPayload {
  userId: number;
  businessId: number;
  phoneNumber: string;
}

export interface whatsappNumberRemovedPayload {
  userId: number;
  businessId: number;
  phoneNumber: string;
}

export interface senderDeliverToWhatsappPayload {
  userId: number;
  businessId: number;
  automationId?: number;
  targetId?: number;
  recipientId?: number;
  recipientType?: "customer" | "lead";
  idempotencyKey?: string;
  payloadRef?: string;
  recipientPhone: string;
  content: {
    body: string;
    attachments?: string[];
  };
}

/**
 * Emitted by the gateway after a lead is persisted (manual create or intake from
 * lead-ingestion). Automations evaluates it against active rules, so it carries
 * the matchable fields instead of forcing a lookup back into the gateway.
 */
export interface LeadCreatedPayload {
  leadId: number;
  businessId: number;
  userId: number;
  source: "facebook" | "google_forms" | "manual" | "import";
  fullName: string | null;
  email: string | null;
  phone: string | null;
  /** Custom form answers, keyed by normalised field slug. */
  fields: Record<string, string>;
  createdAt: string;
}
