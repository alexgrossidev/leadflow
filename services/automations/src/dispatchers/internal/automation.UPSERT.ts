import { automationPayloadSchema, type AutomationPayload } from "../../modules/automations/automation.schema";

/**
 * Validates the `automation` object of automation.created / automation.updated.
 * The error lists field paths only: the payload holds message content.
 */
export function parseAutomationPayload(raw: unknown): AutomationPayload {
  const parsed = automationPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid automation payload: ${issues}`);
  }
  return parsed.data;
}
