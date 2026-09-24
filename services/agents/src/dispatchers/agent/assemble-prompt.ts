import type { TranscriptEntry } from "#core/agent/llm.port";
import type { AgentConfigRecord } from "#modules/agent-config/agent-config.table";
import type { AgentPayload, AssembledPrompt } from "./types.js";
import {
  PERSONA,
  assistantNameBrief,
  forbiddenKeywordsBrief,
} from "./prompts.js";

/**
 * Builds the two halves of a run's prompt. The system half holds only
 * tenant-authored configuration, so it is byte-identical across a tenant's
 * runs and cacheable; everything the customer wrote goes in the transcript.
 */
export const assemblePrompt = (
  config: AgentConfigRecord,
  payload: AgentPayload,
): AssembledPrompt => {
  const sections = [PERSONA];
  if (config.assistantName) {
    sections.push(assistantNameBrief(config.assistantName));
  }
  sections.push(`Operating instructions:\n${config.instructions}`);
  if (config.knowledgeBase) {
    sections.push(`Business information:\n${config.knowledgeBase}`);
  }
  if (config.forbiddenKeywords?.length) {
    sections.push(forbiddenKeywordsBrief(config.forbiddenKeywords));
  }

  const transcript: TranscriptEntry[] = payload.conversation.map((message) =>
    message.role === "user"
      ? { role: "user", text: message.content }
      : { role: "assistant", text: message.content, toolCalls: [] },
  );
  transcript.push({ role: "user", text: payload.inboundMessage.content });

  return { system: sections.join("\n\n"), transcript };
};
