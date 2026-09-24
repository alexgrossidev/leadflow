import { logger } from "@leadflow/shared";
import type { EmailInspector } from "#dispatchers/inspector/email/inspector";
import type { SenderMessage } from "#workers/internal/validation";
import { cleanData } from "./clean/cleaner.main";
import type { StageResult } from "./types";

/**
 * Repairs the recipient address (whitespace, "mailto:", national phone
 * formats...) and, for email, runs the deliverability inspection. Only a
 * "high" warning (a likely fake address) or a BLOCK stops the message; lower
 * warnings mean the value was repaired and the repaired value is used.
 */
export async function SENDER_CLEAN_DATA(message: SenderMessage, inspector: EmailInspector): Promise<StageResult> {
  const channel = message.content.type;
  const raw = channel === "email" ? message.recipientData.email : message.recipientData.phone;
  const cleaned = cleanData(channel, raw);

  if (!cleaned.success || !cleaned.cleanedData) {
    return { result: "FAILURE", error: cleaned.error ?? "Recipient address could not be cleaned" };
  }
  if (cleaned.warningLevel === "high") {
    return { result: "DANGER", error: "Recipient address looks fake", warningLevel: "high" };
  }

  if (channel === "email") {
    const inspection = await inspector.inspect(cleaned.cleanedData);
    if (inspection.action === "BLOCK") {
      return {
        result: "DANGER",
        error: `Undeliverable email address (failed: ${inspection.failed.join(", ")})`,
        warningLevel: "high",
      };
    }
    if (inspection.action === "RISKY") {
      logger.warn(
        { automationId: message.automationId, recipientId: message.recipientData.id, failed: inspection.failed },
        "Risky email address; sending anyway",
      );
    }
  }

  return {
    result: "SUCCESS",
    payload: {
      ...message,
      recipientData: {
        ...message.recipientData,
        ...(channel === "email" ? { email: cleaned.cleanedData } : { phone: cleaned.cleanedData }),
      },
    },
  };
}
