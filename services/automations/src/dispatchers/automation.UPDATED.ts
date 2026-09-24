import type { automationUpdatedPayload } from "@leadflow/shared";
import type { AutomationRepository } from "../modules/automations/automation.repo";
import { parseAutomationPayload } from "./internal/automation.UPSERT";

/**
 * Syncs rule and steps. Existing enrolments keep their progress; the new rule
 * applies to leads created from now on.
 */
export function createAutomationUpdatedHandler(deps: {
  automations: Pick<AutomationRepository, "upsertWithSteps">;
}) {
  return async function AUTOMATION_UPDATED(data: automationUpdatedPayload): Promise<void> {
    await deps.automations.upsertWithSteps(parseAutomationPayload(data.automation));
  };
}
