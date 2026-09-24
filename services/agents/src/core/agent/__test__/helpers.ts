import { z } from "zod";
import type { AgentTool } from "../tool.js";

/** A tool that records its calls; side-effect flag and behaviour are configurable. */
export const recordingTool = (
  name: string,
  options: Partial<Pick<AgentTool, "sideEffects" | "terminal" | "maxCallsPerRun">> & {
    run?: (input: { text: string }) => Promise<string> | string;
  } = {},
) => {
  const calls: Array<{ text: string }> = [];
  const tool: AgentTool<{ text: string }> = {
    name,
    description: `${name} test tool`,
    schema: z.object({ text: z.string().min(1) }).strict(),
    sideEffects: options.sideEffects ?? true,
    terminal: options.terminal,
    maxCallsPerRun: options.maxCallsPerRun,
    execute: async (input) => {
      calls.push(input);
      return options.run ? options.run(input) : "ok";
    },
  };
  return { tool, calls };
};

export const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
});
