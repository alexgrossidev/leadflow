import { BaseController } from "#core/apifactory/base.controller";
import type { OnboardingService } from "./onboarding.service.js";
import { idempotencyKeySchema, onboardingSchema } from "./onboarding.schema.js";

export class OnboardingController extends BaseController<OnboardingService> {
  /**
   * Runs the whole submission and returns a per-field report. 202: work was
   * attempted end to end, but some fields may still be incomplete; the body's
   * `unresolved` lists what the text and website could not supply, for a later
   * pass. A non-2xx here means the request itself was bad.
   */
  onboard = this.catchAsync(async (req, res) => {
    const idempotencyKey = idempotencyKeySchema.parse(req.header("idempotency-key"));
    const input = onboardingSchema.parse(req.body);
    const { result, replayed } = await this.service.onboard(input, idempotencyKey);
    if (replayed) res.setHeader("Idempotent-Replayed", "true");
    return this.accepted(res, result, "Onboarding processed");
  });
}
