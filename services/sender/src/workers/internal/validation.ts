import { createHash } from "node:crypto";
import { z } from "zod";
import { UnrecoverableJobError } from "#core/errors";

/** `AutomationExecuteExternalPayload`, validated at the service boundary. */
const requestSchema = z.object({
  automationId: z.number().int().positive(),
  userId: z.number().int().positive(),
  businessId: z.number().int().positive(),
  recipientData: z.object({
    id: z.number().int().positive(),
    type: z.enum(["customer", "lead"]),
    email: z.string().exactOptional(),
    phone: z.string().exactOptional(),
    assignedToUserId: z.number().int().positive().exactOptional(),
  }),
  content: z.object({
    type: z.enum(["email", "whatsapp"]),
    subject: z.string().exactOptional(),
    content: z.string().exactOptional(),
  }),
});

/**
 * A message travelling through the sender.process stages. `pipeline` is
 * added by the sender itself: `key` identifies the message for job ids and
 * the delivery ledger, `reschedules` counts DELAY/RETRY hops.
 */
const messageSchema = requestSchema.extend({
  pipeline: z.object({
    key: z.string().min(1),
    reschedules: z.number().int().min(0),
  }),
});

export type SenderRequest = z.infer<typeof requestSchema>;
export type SenderMessage = z.infer<typeof messageSchema>;

function parseOrThrow<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload);
  if (!result.success) {
    // Field paths only: the payload carries addresses and message bodies.
    const paths = result.error.issues.map((issue) => issue.path.join(".") || "(root)").join(", ");
    throw new UnrecoverableJobError(`Malformed sender payload: ${paths}`);
  }
  return result.data;
}

export const validateStructure = (payload: unknown): SenderRequest => parseOrThrow(requestSchema, payload);
export const validateMessage = (payload: unknown): SenderMessage => parseOrThrow(messageSchema, payload);

/** Checks a structurally valid request has what its channel needs. Returns the problem, if any. */
export function validateBusinessRules(data: SenderRequest): string | null {
  const { recipientData, content } = data;
  if (content.type === "email") {
    if (!content.subject || !content.content) return "Missing email subject or content";
    if (!recipientData.email) return "Missing recipient email";
  } else {
    if (!recipientData.phone) return "Missing recipient phone";
    if (!content.content) return "Missing WhatsApp content";
  }
  return null;
}

/**
 * Identity of one automation step for one recipient. The request carries no
 * step id, so the step is identified by its channel and content: the same text
 * is never sent twice to the same recipient by the same automation.
 */
export function messageKey(data: SenderRequest): string {
  const contentHash = createHash("sha256")
    .update(JSON.stringify([data.content.type, data.content.subject ?? "", data.content.content ?? ""]))
    .digest("hex")
    .slice(0, 16);
  return `${data.automationId}:${data.recipientData.type}:${data.recipientData.id}:${contentHash}`;
}
