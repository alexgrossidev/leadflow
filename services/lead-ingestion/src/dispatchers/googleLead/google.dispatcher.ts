import { logger as defaultLogger, type Logger } from "#core/logger";
import type { GoogleLeadProcessPayload } from "@leadflow/shared/jobs";

import type { Lead } from "../../modules_inbound/fbLead/lead.schema";
import { parseFieldDataLead } from "../lead/normalise";
import { createGatewayLeadDelivery } from "../lead/lead.delivery";
import { LeadFatalError } from "../../modules_inbound/fbLead/fbLead.errors";
import type { LeadDeliveryClient } from "../lead/lead.types";

export interface GoogleLeadDeps {
  delivery: LeadDeliveryClient;
  logger: Logger;
}

/**
 * Captures one Google Form lead: NORMALISE → DELIVER. Unlike Facebook there is
 * no FETCH (the submission already carries the answers), so the durable job is
 * the source of record and the shared lead_delivery guard (keyed on responseId)
 * provides idempotency. Collaborators are injected for isolated testing.
 */
export class GoogleLeadDispatcher {
  private readonly delivery: LeadDeliveryClient;
  private readonly log: Logger;

  constructor(deps: Partial<GoogleLeadDeps> = {}) {
    this.delivery = deps.delivery ?? createGatewayLeadDelivery();
    this.log = deps.logger ?? defaultLogger;
  }

  async run(payload: GoogleLeadProcessPayload): Promise<void> {
    const lead = this.normalise(payload);
    await this.delivery.deliver(lead, {
      userId: payload.userId,
      businessId: payload.businessId,
      source: "google_forms",
    });
  }

  /** Map the raw answers onto a clean Lead; malformed data is fatal (retry won't fix). */
  private normalise(payload: GoogleLeadProcessPayload): Lead {
    try {
      const lead = parseFieldDataLead({
        id: payload.responseId,
        created_time:
          payload.createdTime !== undefined
            ? new Date(payload.createdTime).toISOString()
            : undefined,
        field_data: payload.answers,
      });
      lead.leadId = payload.responseId;
      // Surface edge antispam soft-flags to the sales rep as a lead field.
      if (payload.flags?.length) {
        lead.customFields.spam_flags = payload.flags.join(", ");
      }
      return lead;
    } catch (err) {
      this.log.error(
        { err, responseId: payload.responseId },
        "Google lead normalise failed",
      );
      throw new LeadFatalError("normalise failed", err);
    }
  }
}
