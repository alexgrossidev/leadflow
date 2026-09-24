import type { AgentEffort } from "./agent.js";

/**
 * Onboarding-specific knobs. The engine is shared with the receptionist agent,
 * but onboarding runs its own effort and budgets independently of it.
 */
export const onboardingConfig = {
  llm: {
    effort: "high" as AgentEffort,
    /** One parse is a submit or a missing-info report; the cap is a runaway guard. */
    maxIterations: 4,
    maxTokens: 16_000,
    /** Token budget per field parse (input + output across iterations). */
    maxRunTokens: 100_000,
    /**
     * Wall-clock budget per field. Each field gets its own, so one slow parse
     * cannot starve the fields after it of time.
     */
    fieldTimeoutMs: 60_000,
  },
  enrichment: {
    enabled: true,
    /** Per-site fetch budget. Enrichment is best-effort and never blocks a run. */
    timeoutMs: 8_000,
    /** Cap on bytes read from a site, so a huge page can't blow up the prompt. */
    maxBytes: 200_000,
    /** Redirect hops followed, each one re-validated against the SSRF guard. */
    maxRedirects: 3,
  },
} as const;

export type OnboardingConfig = typeof onboardingConfig;
