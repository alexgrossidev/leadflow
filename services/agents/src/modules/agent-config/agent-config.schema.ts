import { z } from "zod";
import { AGENT_CAPABILITIES, ASSISTANT_TYPES } from "./agent-config.registry.js";

const INSTRUCTIONS_MAX_CHARS = 20_000;
/**
 * The knowledge base is resent with every model call of every run (it is part
 * of the cached system prompt, but cache writes and misses still bill it), so
 * its size is a direct per-message cost. 50k characters is roughly 12k tokens.
 */
const KNOWLEDGE_BASE_MAX_CHARS = 50_000;
const FORBIDDEN_KEYWORDS_MAX = 200;
const FORBIDDEN_KEYWORD_MAX_CHARS = 64;
const ASSISTANT_NAME_MAX_CHARS = 64;

/** External tenant ids are owned by the gateway, validated as opaque ids. */
const tenantIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Ids may only contain [A-Za-z0-9_-]");

export const agentTenantParamsSchema = z.object({
  businessId: tenantIdSchema,
  userId: tenantIdSchema,
});

export const agentConfigBodySchema = z
  .object({
    instructions: z.string().min(1).max(INSTRUCTIONS_MAX_CHARS),
    assistantName: z
      .string()
      .trim()
      .min(1)
      .max(ASSISTANT_NAME_MAX_CHARS)
      .nullish()
      .transform((value) => value ?? null),
    assistantType: z.enum(ASSISTANT_TYPES).default("receptionist"),
    capabilities: z
      .array(z.enum(AGENT_CAPABILITIES))
      .max(AGENT_CAPABILITIES.length)
      .refine(
        (caps) => new Set(caps).size === caps.length,
        "Capabilities must be unique",
      ),
    knowledgeBase: z
      .string()
      .max(
        KNOWLEDGE_BASE_MAX_CHARS,
        `knowledgeBase must be at most ${KNOWLEDGE_BASE_MAX_CHARS.toLocaleString("en-US")} characters`,
      )
      .nullish()
      .transform((value) => value ?? null),
    forbiddenKeywords: z
      .array(z.string().trim().min(1).max(FORBIDDEN_KEYWORD_MAX_CHARS))
      .max(FORBIDDEN_KEYWORDS_MAX)
      .refine(
        (words) =>
          new Set(words.map((word) => word.toLowerCase())).size === words.length,
        "Forbidden keywords must be unique, ignoring case",
      )
      .default([]),
  })
  .strict();

export type AgentTenantParams = z.infer<typeof agentTenantParamsSchema>;
export type AgentConfigInput = z.output<typeof agentConfigBodySchema>;
