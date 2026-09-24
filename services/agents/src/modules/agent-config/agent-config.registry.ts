/**
 * The closed sets a tenant's config may draw from. Values are persisted, so a
 * member may be added but never renamed or removed without a migration.
 */

/**
 * What a tenant lets the agent do; each receptionist tool declares the
 * capabilities it needs and is only offered when all are enabled. `email` is
 * reserved: no email tools exist yet.
 */
export const AGENT_CAPABILITIES = [
  "whatsapp",
  "email",
  "calendar",
  "files",
] as const;

/** Registry of assistant personas. Only the default exists so far. */
export const ASSISTANT_TYPES = ["receptionist"] as const;

export type AgentCapability = (typeof AGENT_CAPABILITIES)[number];
export type AssistantType = (typeof ASSISTANT_TYPES)[number];
