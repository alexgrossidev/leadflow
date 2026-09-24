import type { Lead } from "../../modules_inbound/fbLead/lead.schema";
import type { GraphLead } from "../../modules_inbound/fbLead/fbLead.api";

/** The Facebook Graph call the capture flow depends on (injectable for tests). */
export interface LeadCaptureApi {
  getLeadDetails(leadId: string, token: string): Promise<GraphLead | null | undefined>;
}

/** Lead source values accepted by the gateway's intake contract. */
export type LeadSource = "facebook" | "google_forms";

/** Owning account and origin channel a lead is delivered under. */
export interface LeadDeliveryContext {
  userId: number;
  businessId: number;
  source: LeadSource;
}

/**
 * Downstream sink for a normalised lead. The dispatcher supplies the owning
 * account so the sink can address the right tenant without re-resolving it.
 */
export interface LeadDeliveryClient {
  deliver(lead: Lead, ctx: LeadDeliveryContext): Promise<void>;
}
