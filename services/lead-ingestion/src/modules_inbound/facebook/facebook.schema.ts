import { z } from "zod";

/**
 * Meta's leadgen webhook. Only the ids we need are required: `ad_id`,
 * `adgroup_id` and `created_time` are absent on organic submissions and on
 * the "test lead" tool, and non-leadgen changes carry a different `value`
 * entirely, so the value is only strictly parsed for leadgen changes.
 */
export const LeadgenChangeValueSchema = z.object({
  leadgen_id: z.string().min(1),
  page_id: z.string().min(1),
  form_id: z.string().min(1).optional(),
  ad_id: z.string().nullish(),
  adgroup_id: z.string().nullish(),
  created_time: z.number().optional(),
});

export const FacebookLeadWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      id: z.string(),
      time: z.number().optional(),
      changes: z
        .array(z.object({ field: z.string(), value: z.unknown() }))
        .default([]),
    }),
  ),
});

export type FacebookLeadWebhookPayload = z.infer<
  typeof FacebookLeadWebhookPayloadSchema
>;

export const fbVerifyQuerySchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string(),
  "hub.challenge": z.string(),
});

/** Query Facebook appends to the redirect URI after the consent dialog. */
export const fbOAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(1024),
});

/** GET /fb/connect: which account the connect flow is started for. */
export const fbConnectQuerySchema = z.object({
  businessId: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});
