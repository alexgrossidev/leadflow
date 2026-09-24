import { z } from "zod";
import type { ToolSpec } from "./llm.port.js";

/**
 * Something the model can do. The schema is the single source of truth: it is
 * rendered to JSON Schema for the provider and enforced at runtime before
 * `execute` runs, because strict tool use is an Anthropic guarantee and the
 * loop must be just as safe on providers that do not offer it.
 */
export interface AgentTool<Input = unknown> {
  name: string;
  description: string;
  schema: z.ZodType<Input>;
  /**
   * Hand-written JSON Schema sent to the provider verbatim instead of one
   * rendered from `schema`. Used by registry-driven tools whose source of truth
   * is JSON (see jsonSchemaTool).
   */
  jsonSchema?: ToolSpec["inputSchema"];
  /**
   * Whether a successful call changes the world (sends a message, books an
   * appointment). Drives the retry policy: once a side-effecting tool has
   * succeeded, the run is never replayed.
   */
  sideEffects: boolean;
  /** The run ends once this tool succeeds; the model gets no further turn. */
  terminal?: boolean;
  /** Successful calls allowed per run. Further calls are rejected back to the model. */
  maxCallsPerRun?: number;
  /** Throw ToolRejection for a call the model can fix; anything else fails the run. */
  execute(input: Input, signal?: AbortSignal): Promise<string>;
}

/** Renders a tool for the provider port. */
export const toToolSpec = (tool: AgentTool): ToolSpec => {
  if (tool.jsonSchema) {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.jsonSchema,
    };
  }
  const { $schema: _dialect, ...schema } = z.toJSONSchema(tool.schema, {
    target: "draft-2020-12",
  }) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: { ...schema, type: "object" },
  };
};

/**
 * Formats schema violations for the model: path and message only, never the
 * offending value (it may be long, and it is the model's own output anyway).
 */
export const describeIssues = (error: z.ZodError): string =>
  error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.join(".") || "(input)"}: ${issue.message}`)
    .join("; ");

/**
 * Defines a tool whose schema is a hand-written JSON Schema (e.g. loaded from a
 * registry file) rather than zod. The provider sees the JSON Schema verbatim; a
 * zod validator is derived from it once so the same runtime check applies.
 */
export const jsonSchemaTool = (
  definition: Omit<AgentTool<Record<string, unknown>>, "schema"> & {
    inputSchema: ToolSpec["inputSchema"];
  },
): AgentTool<Record<string, unknown>> => {
  const { inputSchema, ...rest } = definition;
  return {
    ...rest,
    jsonSchema: inputSchema,
    schema: z.fromJSONSchema(inputSchema) as z.ZodType<Record<string, unknown>>,
  };
};
