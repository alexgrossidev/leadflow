import type { SenderSteps } from "#config/constants";
import type { SenderMessage } from "#workers/internal/validation";

export enum HumanReadableErrorMessages {
  EMPTY_INPUT = "No email provided",
  MULTIPLE_EMAILS = "Multiple emails detected in a single field",
  MISSING_AT = "Missing @ symbol",
  INVALID_STRUCTURE = "Invalid email structure",
  INVALID_DOMAIN = "Invalid domain",
  INVALID_LOCAL = "Invalid local part",
  TOO_LONG = "Email exceeds maximum length",
  UNRECOVERABLE = "Input could not be repaired into a valid email",
}

export enum HumanReadablePhoneErrors {
  EMPTY_INPUT = "No phone number provided",
  MULTIPLE_NUMBERS = "Multiple numbers detected in a single field",
  NO_DIGITS = "No digits found",
  TOO_SHORT = "Phone number too short",
  TOO_LONG = "Phone number too long",
  INVALID_STRUCTURE = "Invalid phone number structure",
  UNRECOVERABLE = "Input could not be repaired into a valid phone number",
}

export interface CleanDataResult {
  success: boolean;
  cleanedData?: string;
  error?: HumanReadableErrorMessages | HumanReadablePhoneErrors;
  warningLevel?: WarningLevel;
}

export type WarningLevel = "none" | "low" | "medium" | "high";

/**
 * What a pipeline stage decided:
 * - SUCCESS: continue to the next stage (with `payload` if the stage refined it);
 * - DELAY: run `stage` (default: the same one) again in `delayMs`;
 * - RETRY: run the same stage again after the default back-off;
 * - FAILURE: the message cannot be sent (bad data, no opening hours);
 * - DANGER: it could be sent but should not be (likely fake or undeliverable).
 * FAILURE and DANGER end the pipeline and are recorded in sending_errors.
 */
export type StageResult =
  | { result: "SUCCESS"; payload?: SenderMessage; done?: boolean }
  | { result: "DELAY"; delayMs?: number; reason: string; stage?: SenderSteps }
  | { result: "RETRY"; reason: string }
  | { result: "FAILURE" | "DANGER"; error: string; warningLevel?: WarningLevel };
