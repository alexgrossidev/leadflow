/**
 * Receptionist-agent tuning. These are product decisions, not deployment
 * secrets, so they live in code. The vendor, model and effort come from the
 * environment (see env.ts) because they change per deployment.
 */

export const AGENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

export const agentConfig = {
  llm: {
    /** Safety rails on a single run's agent loop. */
    maxIterations: 8,
    /** Per-response output cap. Non-streaming, so kept under SDK HTTP timeouts. */
    maxTokens: 16_000,
    /**
     * Input + output tokens one run may spend across all its iterations. Every
     * iteration resends the whole prompt, so a looping run grows quadratically;
     * this bounds the worst case per inbound message.
     */
    maxRunTokens: 200_000,
    /** Wall-clock budget per run, retries included; cancels the model and gateway calls when spent. */
    runTimeoutMs: 180_000,
  },
  /**
   * Bounded retry for transient provider failures (429/5xx/network). Never
   * retried once a side-effecting tool has succeeded: replaying the run would
   * message the customer twice.
   */
  retry: {
    attempts: 3,
    baseDelayMs: 1_000,
    maxDelayMs: 15_000,
  },
} as const;
