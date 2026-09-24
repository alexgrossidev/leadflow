import { z } from "zod";
import type { AgentLoop } from "#core/agent/loop";
import type { TokenUsage } from "#core/agent/llm.port";
import { jsonSchemaTool, type AgentTool } from "#core/agent/tool";
import type { OnboardingField } from "./registry.js";
import { PARSER_PERSONA, fieldBrief, parseRequest } from "./prompts.js";

export interface FieldParse {
  /** The structured record, when the model had everything it needed. */
  payload?: Record<string, unknown>;
  /** Required values not found in text or website. */
  missing?: string[];
  /** Tokens this parse spent, for the run's total. */
  usage: TokenUsage;
}

export interface ParseInput {
  text: string;
  locale: string;
  enrichment?: string;
  signal?: AbortSignal;
}

/**
 * Parses one field's free-form text into its structured record by driving the
 * shared agent loop with exactly two moves: submit the record, or report what
 * is missing. Both are side-effect free (they only capture the model's answer;
 * the gateway is called later, by dispatchField), so a transient provider
 * failure mid-parse stays retryable. Both are terminal: once the model has
 * answered there is nothing to gain from another round trip.
 *
 * The submitted record is validated against the field's JSON Schema before it
 * is captured, so an invalid record is sent back to the model to fix instead of
 * reaching the gateway.
 */
export const parseField = async (
  loop: AgentLoop,
  field: OnboardingField,
  input: ParseInput,
): Promise<FieldParse> => {
  const captured: Omit<FieldParse, "usage"> = {};

  const submit = jsonSchemaTool({
    name: "submit_details",
    description: `Submit the structured ${field.key} record once every required value is known.`,
    inputSchema: field.payload,
    sideEffects: false,
    terminal: true,
    execute: async (record) => {
      captured.payload = record;
      return "Saved.";
    },
  });

  const reportMissing: AgentTool<{ missing: string[] }> = {
    name: "report_missing_info",
    description:
      "Call when a required value is not in the owner's text or the website content. List exactly what is missing. This is recorded, not asked: there is no one to answer.",
    schema: z
      .object({ missing: z.array(z.string().min(1).max(500)).min(1).max(50) })
      .strict(),
    sideEffects: false,
    terminal: true,
    execute: async ({ missing }) => {
      captured.missing = missing;
      return "Noted.";
    },
  };

  const outcome = await loop.run({
    system: [PARSER_PERSONA, fieldBrief(field)].join("\n\n"),
    transcript: [
      {
        role: "user",
        text: parseRequest({
          locale: input.locale,
          text: input.text,
          enrichment: input.enrichment,
        }),
      },
    ],
    signal: input.signal,
    tools: [submit, reportMissing],
  });

  return { ...captured, usage: outcome.usage };
};
