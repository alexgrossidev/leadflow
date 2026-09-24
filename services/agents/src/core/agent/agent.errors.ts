import { AppError } from "#core/errors/app-error";
import type { TokenUsage } from "./llm.port.js";

export const AGENT_ERROR_CODES = {
  providerMisconfigured: "AGENT_PROVIDER_MISCONFIGURED",
  providerFailed: "AGENT_PROVIDER_FAILED",
  unsupportedStopReason: "AGENT_UNSUPPORTED_STOP_REASON",
  refused: "AGENT_REFUSED",
  truncated: "AGENT_TRUNCATED",
  iterationCap: "AGENT_ITERATION_CAP",
  budgetExceeded: "AGENT_BUDGET_EXCEEDED",
  payloadMissing: "AGENT_PAYLOAD_MISSING",
  configMissing: "AGENT_CONFIG_MISSING",
  noCapabilities: "AGENT_NO_CAPABILITIES",
  toolFailed: "AGENT_TOOL_FAILED",
  timeout: "AGENT_TIMEOUT",
  interrupted: "AGENT_INTERRUPTED",
} as const;

export type AgentErrorCode =
  (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

/**
 * Engine failure. Runs execute in the background, so `statusCode` is only for
 * AppError conformance; `code`, `retryable` and `mutated` are what the retry
 * policy classifies on.
 */
export class AgentError extends AppError {
  readonly code: AgentErrorCode;
  /**
   * Set by the provider adapter, which is the only layer that can tell a
   * transient vendor failure (429, 5xx, dropped connection) from a permanent
   * one. Everything else defaults to false: an unrecognised failure surfaces as
   * one clean failed run instead of burning the retry budget.
   */
  readonly retryable: boolean;
  /**
   * True once a tool with side effects has succeeded in this run. Replaying the
   * run would repeat that effect (messaging the customer twice), so a mutated
   * failure is never retried, however transient its cause.
   */
  mutated = false;
  /** Tokens the run spent before failing, so a failed run's cost is still reported. */
  usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(
    message: string,
    code: AgentErrorCode,
    options: { cause?: unknown; retryable?: boolean } = {},
  ) {
    super(message, 500, code);
    this.name = "AgentError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * A tool refusing a call the model can fix (bad arguments, a forbidden word, a
 * per-run limit). Nothing was performed; the message goes back to the model as
 * that call's error result and the run continues.
 */
export class ToolRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolRejection";
  }
}
