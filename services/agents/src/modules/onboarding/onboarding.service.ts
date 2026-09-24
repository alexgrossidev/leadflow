import { createHash } from "node:crypto";
import { ConflictError } from "#core/errors/http-errors";
import type { OnboardingResult } from "#dispatchers/onboarding/types";
import type { IdempotencyStore } from "./onboarding.repository.js";
import type { OnboardingRequest } from "./onboarding.schema.js";

/** ONBOARD with its dependencies bound. */
export type RunOnboarding = (request: OnboardingRequest) => Promise<OnboardingResult>;

export interface OnboardingResponse {
  result: OnboardingResult;
  /** True when this is a stored result for a key that already completed. */
  replayed: boolean;
}

/** Stable across key order, so the same body always hashes the same. */
const hashRequest = (request: OnboardingRequest): string => {
  const canonical = JSON.stringify(request, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value,
  );
  return createHash("sha256").update(canonical).digest("hex");
};

/**
 * Seam between the HTTP surface and the onboarding dispatcher, and the owner
 * of idempotency: the same key and body return the stored result, a key still
 * running or reused for a different body is refused, and only a fresh key
 * runs onboarding.
 */
export class OnboardingService {
  constructor(
    private readonly store: IdempotencyStore,
    private readonly runOnboarding: RunOnboarding,
  ) {}

  async onboard(request: OnboardingRequest, idempotencyKey: string): Promise<OnboardingResponse> {
    const hash = hashRequest(request);
    const claim = await this.store.begin(request.userId, idempotencyKey, hash);

    if (!claim.started) {
      const { existing } = claim;
      if (existing.requestHash !== hash) {
        throw new ConflictError(
          "Idempotency-Key was already used with a different request body",
          "IDEMPOTENCY_KEY_REUSED",
        );
      }
      if (existing.status === "completed" && existing.result) {
        return { result: existing.result, replayed: true };
      }
      if (existing.status === "in_progress") {
        throw new ConflictError(
          "A request with this Idempotency-Key is still in progress",
          "IDEMPOTENCY_IN_PROGRESS",
        );
      }
      // A run that crashed part-way may already have created records, so it
      // is not re-run under the same key.
      throw new ConflictError(
        "A request with this Idempotency-Key failed; inspect the created records before retrying with a new key",
        "IDEMPOTENCY_PREVIOUS_FAILED",
      );
    }

    try {
      const result = await this.runOnboarding(request);
      await this.store.complete(request.userId, idempotencyKey, result);
      return { result, replayed: false };
    } catch (error) {
      await this.store.fail(request.userId, idempotencyKey).catch(() => undefined);
      throw error;
    }
  }
}
