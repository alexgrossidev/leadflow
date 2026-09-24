import { createHash } from "crypto";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { eventNames, type senderDeliverToWhatsappPayload } from "@leadflow/shared";
import { requireServiceToken } from "#core/middleware/service-token";
import { UnprocessableEntityError } from "#core/errors/http-errors";
import { emitToWhatsapp } from "../../comms/bullmq/bullmq.eventEmitter.js";

/**
 * Bridge for the agents service's `respond_whatsapp` tool.
 *
 * The AI receptionist doesn't talk to the WhatsApp transport directly: its reply
 * becomes the same `whatsapp.message.created` event the automation sender
 * produces, so both share one delivery path — idempotency, message log, retries
 * and session handling live in the whatsapp service only.
 */

/** A WhatsApp chat id is the customer's number: E.164 (`+39…`) or wppconnect's `<digits>@c.us`. */
const whatsappChatId = z
  .string()
  .trim()
  .regex(/^(\+?\d{6,15}|\d{6,15}@c\.us)$/, "conversationId must be a WhatsApp chat id");

export const agentReplySchema = z.object({
  businessId: z.number().int().positive(),
  userId: z.number().int().positive(),
  conversationId: whatsappChatId,
  message: z.string().trim().min(1).max(4096),
});

export type AgentReply = z.infer<typeof agentReplySchema>;

export function toWhatsappRequest(reply: AgentReply): senderDeliverToWhatsappPayload {
  const digits = reply.conversationId.replace(/@c\.us$/, "").replace(/^\+/, "");
  // Same reply to the same chat dedupes, mirroring the sender's content-hash key;
  // the phone number itself stays out of the key (it ends up in queue ids and logs).
  const idempotencyKey = `agent:${reply.businessId}:${createHash("sha256")
    .update(`${digits}\n${reply.message}`)
    .digest("hex")
    .slice(0, 32)}`;
  return {
    businessId: reply.businessId,
    userId: reply.userId,
    idempotencyKey,
    recipientPhone: `+${digits}`,
    content: { body: reply.message },
  };
}

export interface AgentReplyDeps {
  businessBelongsToUser(businessId: number, userId: number): Promise<boolean>;
  emit?: (payload: senderDeliverToWhatsappPayload, jobId: string) => Promise<unknown>;
}

const defaultEmit = (payload: senderDeliverToWhatsappPayload, jobId: string) =>
  emitToWhatsapp(eventNames.WHATSAPP_REQUEST_CREATED, payload, { jobId });

/** Mounted under `/internal/agents`; service token only. Responds 202: delivery is asynchronous. */
export function createAgentReplyRouter({ businessBelongsToUser, emit = defaultEmit }: AgentReplyDeps): Router {
  const router = Router();
  router.use(requireServiceToken);
  router.post("/whatsapp/send", async (req: Request, res: Response) => {
    const reply = agentReplySchema.parse(req.body);
    if (!(await businessBelongsToUser(reply.businessId, reply.userId))) {
      throw new UnprocessableEntityError("Business does not belong to user", "BUSINESS_USER_MISMATCH");
    }
    const payload = toWhatsappRequest(reply);
    await emit(payload, payload.idempotencyKey!);
    res.status(202).json({ idempotencyKey: payload.idempotencyKey });
  });
  return router;
}
