import type { Env } from "#config/env";
import type { AgentEffort } from "#config/agent";
import type { LlmProvider } from "../llm.port.js";
import { AnthropicProvider } from "./anthropic.provider.js";
import { FakeLlmProvider } from "./fake.provider.js";
import { GeminiProvider } from "./gemini.provider.js";

export type LlmProviderId = Env["LLM_PROVIDER"];

type ProviderEnv = Pick<
  Env,
  | "LLM_PROVIDER"
  | "ANTHROPIC_API_KEY"
  | "ANTHROPIC_MODEL"
  | "ANTHROPIC_EFFORT"
  | "ANTHROPIC_REFUSAL_FALLBACK"
  | "GEMINI_API_KEY"
  | "GEMINI_MODEL"
>;

/** Per-caller overrides. Omitted values fall back to the environment. */
export interface LlmProviderOverrides {
  provider?: LlmProviderId;
  model?: string;
  effort?: AgentEffort;
}

/**
 * The only place that decides which vendor runs. Adding a provider means one
 * adapter that satisfies LlmProvider plus one case here; the engine, prompts,
 * tools and dispatchers stay untouched.
 */
export const createLlmProvider = (
  config: ProviderEnv,
  overrides: LlmProviderOverrides = {},
): LlmProvider => {
  const provider = overrides.provider ?? config.LLM_PROVIDER;
  switch (provider) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: config.ANTHROPIC_API_KEY,
        model: overrides.model ?? config.ANTHROPIC_MODEL,
        effort: overrides.effort ?? config.ANTHROPIC_EFFORT,
        refusalFallback: config.ANTHROPIC_REFUSAL_FALLBACK,
      });
    case "gemini":
      // Effort is an Anthropic knob; the Gemini adapter has no equivalent.
      return new GeminiProvider({
        apiKey: config.GEMINI_API_KEY,
        model: overrides.model ?? config.GEMINI_MODEL,
      });
    case "fake":
      return new FakeLlmProvider();
  }
};
