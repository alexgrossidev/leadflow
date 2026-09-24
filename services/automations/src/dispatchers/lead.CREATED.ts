import { logger, type LeadCreatedPayload } from "@leadflow/shared";
import type { AutomationRow } from "../modules/automations/automation.table";
import { matchesRule } from "../modules/automations/automation.rules";
import type { EnrolmentService } from "../modules/enrolment/enrolment.service";

export interface LeadCreatedDeps {
  automations: { listActive(businessId: number, type: "lead" | "customer"): Promise<AutomationRow[]> };
  enrolment: Pick<EnrolmentService, "enrol">;
}

/**
 * Entry point of the pipeline: a new lead is enrolled in every active
 * automation of its business whose rule it satisfies.
 */
export function createLeadCreatedHandler(deps: LeadCreatedDeps) {
  return async function LEAD_CREATED(lead: LeadCreatedPayload): Promise<void> {
    const active = await deps.automations.listActive(lead.businessId, "lead");
    const matching = active.filter((automation) => matchesRule(automation, lead));

    const enrolled = await deps.enrolment.enrol(
      matching.map((automation) => ({
        automation,
        contact: { originalId: lead.leadId, email: lead.email, phone: lead.phone },
      })),
    );

    logger.info(
      { leadId: lead.leadId, businessId: lead.businessId, candidates: active.length, enrolled },
      "Lead evaluated against active automations",
    );
  };
}
