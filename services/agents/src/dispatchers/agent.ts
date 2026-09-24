import { AGENT_ERROR_CODES, AgentError } from "#core/agent/agent.errors";
import type { AgentLoop, AgentOutcome } from "#core/agent/loop";
import type { LeadflowClient } from "#core/axios/leadflow.client";
import type { AgentActionRecord } from "#modules/action/action.table";
import type { AgentConfigRecord } from "#modules/agent-config/agent-config.table";
import { assemblePrompt } from "./agent/assemble-prompt.js";
import { buildReceptionistTools } from "./agent/tools.js";

export interface AgentDispatcherDeps {
  loop: AgentLoop;
  client: LeadflowClient;
  attachmentUrlPrefixes: readonly string[];
}

/**
 * Decides and performs what an inbound message calls for. The choice is the
 * model's, expressed as tool calls; each tool turns that choice into one
 * gateway call.
 *
 * Returns metadata only (which tools ran, token usage), never message content.
 */
export const DISPATCH_AGENT_ACTION = async (
  action: AgentActionRecord,
  config: AgentConfigRecord,
  deps: AgentDispatcherDeps,
  signal?: AbortSignal,
): Promise<AgentOutcome> => {
  if (!action.payload) {
    throw new AgentError(
      `Action ${action.id} has no trigger payload to dispatch`,
      AGENT_ERROR_CODES.payloadMissing,
    );
  }

  const tools = buildReceptionistTools({
    businessId: action.businessId,
    userId: action.userId,
    conversationId: action.payload.conversationId,
    forbiddenKeywords: config.forbiddenKeywords ?? [],
    capabilities: config.capabilities,
    attachmentUrlPrefixes: deps.attachmentUrlPrefixes,
    client: deps.client,
  });
  if (!tools.some((tool) => tool.name === "respond_whatsapp")) {
    throw new AgentError(
      "Tenant has not enabled the whatsapp capability, so the agent cannot reply",
      AGENT_ERROR_CODES.noCapabilities,
    );
  }

  const { system, transcript } = assemblePrompt(config, action.payload);
  return deps.loop.run({ system, transcript, tools, signal, traceId: action.id });
};
