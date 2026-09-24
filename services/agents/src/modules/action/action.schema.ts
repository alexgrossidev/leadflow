import { z } from "zod";
import { ACTION_STATUSES, ACTION_TYPES } from "./action.registry.js";

/** External tenant ids are owned by the gateway, validated as opaque ids. */
const tenantIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Ids may only contain [A-Za-z0-9_-]");

const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 200;
const MESSAGE_MAX_CHARS = 10_000;
const CONVERSATION_MAX_MESSAGES = 200;

const conversationMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MESSAGE_MAX_CHARS),
});

/**
 * The trigger's message content. Structured rather than opaque because the
 * dispatcher reads it to build the transcript.
 */
export const actionPayloadSchema = z
  .object({
    // Opaque gateway thread id. The reply is routed back to this conversation:
    // bound from the trigger, never from model output.
    conversationId: z.string().min(1).max(128),
    conversation: z
      .array(conversationMessageSchema)
      .max(CONVERSATION_MAX_MESSAGES)
      .default([]),
    inboundMessage: z.object({
      content: z.string().min(1).max(MESSAGE_MAX_CHARS),
    }),
  })
  .strict();

export const actionTenantParamsSchema = z.object({
  businessId: tenantIdSchema,
  userId: tenantIdSchema,
});

export const actionIdParamSchema = z.object({ id: z.uuid() });

/** The trigger the gateway POSTs when a customer message arrives. */
export const actionCreateSchema = z
  .object({
    businessId: tenantIdSchema,
    userId: tenantIdSchema,
    type: z.enum(ACTION_TYPES),
    payload: actionPayloadSchema,
  })
  .strict();

export const actionListQuerySchema = z
  .object({
    status: z.enum(ACTION_STATUSES).optional(),
    type: z.enum(ACTION_TYPES).optional(),
    limit: z.coerce.number().int().min(1).max(LIST_LIMIT_MAX).default(LIST_LIMIT_DEFAULT),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type ActionTenantParams = z.infer<typeof actionTenantParamsSchema>;
export type ActionCreateInput = z.output<typeof actionCreateSchema>;
export type ActionListQuery = z.output<typeof actionListQuerySchema>;

/** Structurally an AgentPayload, which is what `assemblePrompt` consumes. */
export type ActionPayload = z.output<typeof actionPayloadSchema>;
