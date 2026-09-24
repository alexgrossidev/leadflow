import type { TokenUsage } from "#core/agent/llm.port";

/**
 * One raw onboarding submission. `inputs` maps a field key (declared in
 * fields.json) to the owner's free-form text for that field.
 *
 * Identity is bound from the trigger, never from parsed model output. The
 * business may not exist yet (business_info creates it), so `businessId` is
 * optional and gets filled in mid-run once the creating call returns.
 */
export interface OnboardingInput {
  userId: string;
  businessId?: string;
  locale: string;
  inputs: Record<string, string>;
}

export type FieldStatus = "created" | "incomplete" | "unregistered" | "failed";

/** What became of one field of the submission. */
export interface FieldResult {
  key: string;
  status: FieldStatus;
  /**
   * Required values the parser could not find in the text or the website.
   * Onboarding is unattended: these are recorded for a later pass, not
   * questions to the owner.
   */
  missing?: string[];
  /** Human-readable note on a failure or skip. Never carries model content. */
  detail?: string;
}

export interface OnboardingResult {
  /** The business created (or targeted) by this run, once known. */
  businessId?: string;
  results: FieldResult[];
  /** Flattened unresolved gaps across every field, for a later data-gathering pass. */
  unresolved: { key: string; missing: string[] }[];
  usage: TokenUsage;
}

/**
 * Threaded through every field of one run. Mutable in two ways: the field that
 * creates the business writes `businessId` here so later fields attach to it,
 * and the first website lookup caches its text so every field can mine it.
 */
export interface OnboardingContext {
  userId: string;
  businessId?: string;
  locale: string;
  /** Text pulled from the business's website, shared across fields once fetched. */
  enrichment?: string;
}
