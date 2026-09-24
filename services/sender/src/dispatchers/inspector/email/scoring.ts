import type { EmailCheckResult } from "./types/check.types";

export type InspectionAction = "SAFE" | "LOW_CONFIDENCE" | "RISKY" | "BLOCK";

/**
 * Turns check results into a decision. A single critical failure (score
 * <= -50, e.g. no MX record or a disposable domain) blocks on its own.
 */
export function evaluateAction(score: number, results: EmailCheckResult[]): InspectionAction {
  const failed = results.filter((r) => r.score < 0).map((r) => r.name);
  const hasCriticalFailure = results.some((r) => r.score <= -50);

  if (score < -50 || hasCriticalFailure) return "BLOCK";
  if (score < 0 || failed.includes("typo")) return "RISKY";
  if (score >= 30) return "SAFE";
  return "LOW_CONFIDENCE";
}
