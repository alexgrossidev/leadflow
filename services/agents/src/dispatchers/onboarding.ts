import { AgentError } from "#core/agent/agent.errors";
import type { TokenUsage } from "#core/agent/llm.port";
import type { AgentLoop } from "#core/agent/loop";
import type { LeadflowClient } from "#core/axios/leadflow.client";
import { LeadflowError } from "#core/axios/leadflow.errors";
import { logger } from "#core/logger";
import { dispatchField } from "./onboarding/dispatch-field.js";
import { extractUrl, type WebsiteEnricher } from "./onboarding/enrich.js";
import { parseField } from "./onboarding/parse-field.js";
import { getField, orderedFields, type OnboardingField } from "./onboarding/registry.js";
import type {
  FieldResult,
  OnboardingContext,
  OnboardingInput,
  OnboardingResult,
} from "./onboarding/types.js";

export interface OnboardDeps {
  loop: AgentLoop;
  enricher: WebsiteEnricher;
  client: LeadflowClient;
  /** Wall-clock budget per field (parse + dispatch). */
  fieldTimeoutMs: number;
  /** Enrichment's own budget, independent of any field's. */
  enrichmentTimeoutMs: number;
}

/**
 * Turns one free-form onboarding submission into a set of gateway calls. Each
 * field is parsed and dispatched in isolation, in registry (dependency) order,
 * so the business is created before services, hours and users attach to it.
 *
 * Onboarding is unattended (there is no one to ask), so missing detail is
 * gathered from the business's website (fetched once, shared across fields)
 * and anything still unknown is recorded as an unresolved gap for a later
 * pass. A field that fails is recorded and the run goes on. No field's outcome
 * is silently lost, and every token spent is reported, failures included.
 */
export const ONBOARD = async (
  input: OnboardingInput,
  deps: OnboardDeps,
): Promise<OnboardingResult> => {
  const context: OnboardingContext = {
    userId: input.userId,
    businessId: input.businessId,
    locale: input.locale,
  };

  const usage: Required<TokenUsage> = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const results: FieldResult[] = [];

  for (const key of Object.keys(input.inputs).filter((key) => !getField(key))) {
    results.push({
      key,
      status: "unregistered",
      detail: "No parser registered for this field.",
    });
  }

  for (const field of orderedFields(input.inputs)) {
    const text = input.inputs[field.key]!;
    await ensureEnrichment(deps, field, text, context);
    const outcome = await runField(deps, field, text, context);
    usage.inputTokens += outcome.usage.inputTokens;
    usage.outputTokens += outcome.usage.outputTokens;
    usage.cacheReadTokens += outcome.usage.cacheReadTokens ?? 0;
    usage.cacheWriteTokens += outcome.usage.cacheWriteTokens ?? 0;
    results.push(outcome.result);
  }

  return {
    businessId: context.businessId,
    results,
    unresolved: results.flatMap((result) =>
      result.missing?.length ? [{ key: result.key, missing: result.missing }] : [],
    ),
    usage,
  };
};

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/** Parse then dispatch one field under its own deadline, recording any failure. */
const runField = async (
  deps: OnboardDeps,
  field: OnboardingField,
  text: string,
  context: OnboardingContext,
): Promise<{ result: FieldResult; usage: TokenUsage }> => {
  const signal = AbortSignal.timeout(deps.fieldTimeoutMs);
  let usage = ZERO;
  try {
    const parsed = await parseField(deps.loop, field, {
      text,
      locale: context.locale,
      enrichment: context.enrichment,
      signal,
    });
    usage = parsed.usage;

    if (!parsed.payload) {
      return {
        result: {
          key: field.key,
          status: "incomplete",
          missing: parsed.missing ?? ["Required details could not be determined."],
        },
        usage,
      };
    }

    await dispatchField(field, parsed.payload, context, { client: deps.client, signal });
    return { result: { key: field.key, status: "created" }, usage };
  } catch (error) {
    // A failed parse still spent tokens; the loop stamps them on the error.
    if (error instanceof AgentError) usage = error.usage;
    logger.error({ err: error, field: field.key }, "Onboarding field failed");
    return {
      result: {
        key: field.key,
        status: "failed",
        // Codes and route/status only: never model output or request bodies.
        detail:
          error instanceof AgentError
            ? error.code
            : error instanceof LeadflowError
              ? error.message
              : "Unexpected error",
      },
      usage,
    };
  }
};

/**
 * Fetches the business's website once and caches its text on the context so
 * every field can mine it. Best-effort: only for fields that opt in, only when
 * a URL is present, and any failure is swallowed so enrichment never sinks a
 * run.
 */
const ensureEnrichment = async (
  deps: OnboardDeps,
  field: OnboardingField,
  text: string,
  context: OnboardingContext,
): Promise<void> => {
  if (context.enrichment || !field.enrich) return;
  const url = extractUrl(text);
  if (!url) return;
  const enriched = await deps.enricher
    .enrich(url, AbortSignal.timeout(deps.enrichmentTimeoutMs))
    .catch(() => undefined);
  if (enriched) context.enrichment = enriched;
};
