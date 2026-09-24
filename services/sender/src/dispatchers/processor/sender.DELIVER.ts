import { createHash } from "node:crypto";
import { logger } from "@leadflow/shared";
import { SenderSteps } from "#config/constants";
import type { EmailTransport } from "#core/email.transport";
import type { WhatsappPublisher } from "#core/whatsapp.publisher";
import type { DeliveryRecord } from "#modules/deliveries/deliveries.table";
import type { SenderMessage } from "#workers/internal/validation";
import { localDayKey } from "./limiter/time.utils";
import { SENDER_DEADTIME, type DeadTimeDeps } from "./sender.DEADTIME";
import { SENDER_LIMITS, type LimitsDeps } from "./sender.LIMITS";
import type { StageResult } from "./types";

export interface DeliverDeps extends LimitsDeps, DeadTimeDeps {
  usage: LimitsDeps["usage"] & DeadTimeDeps["usage"];
  deliveries: {
    isDelivered(messageKey: string): Promise<boolean>;
    record(delivery: DeliveryRecord): Promise<void>;
  };
  email: EmailTransport;
  whatsapp: WhatsappPublisher;
}

/** Stable across retries of the same message; the whatsapp service dedupes on it. */
function buildWhatsappIdempotencyKey(message: SenderMessage): string {
  const contentHash = createHash("sha256")
    .update(message.content.content ?? "")
    .digest("hex")
    .slice(0, 16);
  return ["whatsapp", message.automationId, message.recipientData.id, contentHash].join(":");
}

/**
 * Sends the message on its channel, then records it in the delivery ledger
 * and bumps the user's daily counter in one transaction.
 *
 * Limits and pacing are checked again here, right before sending. The earlier
 * stages park a message until it is likely to pass, but several messages can
 * clear them together; this final check runs with the send and the counter
 * update (stages are processed one at a time), so caps and gaps hold. The
 * ledger check makes a replayed DELIVER job a no-op once the send was recorded.
 */
export async function SENDER_DELIVER(
  message: SenderMessage,
  deps: DeliverDeps,
  now: Date,
  rng: () => number,
): Promise<StageResult> {
  const key = message.pipeline.key;
  if (await deps.deliveries.isDelivered(key)) {
    logger.info({ automationId: message.automationId, recipientId: message.recipientData.id }, "Already delivered; skipping");
    return { result: "SUCCESS", done: true };
  }

  const limits = await SENDER_LIMITS(message, deps, now, rng);
  if (limits.result === "DELAY") return { ...limits, stage: SenderSteps.CALCULATE_LIMITS };
  if (limits.result !== "SUCCESS") return limits;

  const pacing = await SENDER_DEADTIME(message.userId, message.businessId, deps, now);
  if (pacing.result === "DELAY") return { ...pacing, stage: SenderSteps.CALCULATE_DEAD_TIME };

  const channel = message.content.type;
  if (channel === "email") {
    await deps.email.send({
      to: message.recipientData.email ?? "",
      subject: message.content.subject ?? "",
      text: message.content.content ?? "",
      messageId: `<${createHash("sha256").update(key).digest("hex").slice(0, 32)}@leadflow.sender>`,
    });
  } else {
    await deps.whatsapp.publish({
      userId: message.userId,
      businessId: message.businessId,
      automationId: message.automationId,
      targetId: message.recipientData.id,
      recipientId: message.recipientData.id,
      recipientType: message.recipientData.type,
      idempotencyKey: buildWhatsappIdempotencyKey(message),
      recipientPhone: message.recipientData.phone ?? "",
      content: { body: message.content.content ?? "", attachments: [] },
    });
  }

  const settings = await deps.settings.getForBusiness(message.businessId);
  await deps.deliveries.record({
    messageKey: key,
    automationId: message.automationId,
    recipientType: message.recipientData.type,
    recipientId: message.recipientData.id,
    userId: message.userId,
    businessId: message.businessId,
    channel,
    sentAt: now,
    day: localDayKey(now, settings.timezone),
  });
  logger.info(
    { automationId: message.automationId, recipientId: message.recipientData.id, channel, userId: message.userId },
    "Message delivered",
  );
  return { result: "SUCCESS", done: true };
}
