import { logger, type automationCreatedPayload } from "@leadflow/shared";
import type { AutomationRepository } from "../modules/automations/automation.repo";
import type { LeadBackfill } from "../protomodules/leads/lead.backfill";
import { parseAutomationPayload } from "./internal/automation.UPSERT";

export interface AutomationCreatedDeps {
  automations: Pick<AutomationRepository, "upsertWithSteps" | "getById">;
  backfill: Pick<LeadBackfill, "run">;
}

/**
 * Stores the new automation, then enrols the leads that already match it.
 * Safe to redeliver: the upsert and the enrolment are both idempotent.
 */
export function createAutomationCreatedHandler(deps: AutomationCreatedDeps) {
  return async function AUTOMATION_CREATED(data: automationCreatedPayload): Promise<void> {
    const payload = parseAutomationPayload(data.automation);
    await deps.automations.upsertWithSteps(payload);

    const automation = await deps.automations.getById(payload.id);
    if (!automation || automation.paused || automation.scheduledDeletionAt) {
      logger.info({ automationId: payload.id }, "Automation stored inactive; skipping backfill");
      return;
    }
    if (automation.automationType !== "lead") {
      logger.info({ automationId: payload.id }, "Only lead automations are backfilled");
      return;
    }
    await deps.backfill.run(automation);
  };
}
