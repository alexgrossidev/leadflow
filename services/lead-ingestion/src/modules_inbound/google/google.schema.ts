import { z } from "zod";

/** One Google Form answer: the question label plus its value(s). */
const GoogleLeadAnswerSchema = z.object({
  name: z.string().min(1),
  values: z.array(z.string()),
});

/**
 * The submission envelope the relay POSTs. Tenant (userId/businessId) travels in
 * the body and is trusted only because the whole body is HMAC-verified at the
 * edge. `responseId` is the idempotency key. `createdTime` (epoch ms) is
 * required: it is what bounds the replay window, so a signed body captured
 * once cannot be replayed forever.
 */
export const GoogleLeadWebhookPayloadSchema = z.object({
  userId: z.number().int().positive(),
  businessId: z.number().int().positive(),
  formId: z.string().min(1).optional(),
  responseId: z.string().min(1),
  createdTime: z.number().int().positive(),
  answers: z.array(GoogleLeadAnswerSchema),
});

export type GoogleLeadWebhookPayload = z.infer<
  typeof GoogleLeadWebhookPayloadSchema
>;
