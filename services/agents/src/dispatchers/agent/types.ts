import type { TranscriptEntry } from "#core/agent/llm.port";

export interface AgentConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Trigger content: customer message text. Persisted only until the run reaches
 * a terminal status, then purged (see ActionExecutor).
 */
export interface AgentPayload {
  conversationId: string;
  conversation: AgentConversationMessage[];
  inboundMessage: { content: string };
}

export interface AssembledPrompt {
  system: string;
  transcript: TranscriptEntry[];
}
