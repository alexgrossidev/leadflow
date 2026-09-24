import { Request, Response } from "express";
import { noContent } from "#core/http/response";
import { getAuth } from "#core/http/request-context";
import { OnboardingService } from "./onboarding.service.js";
import { onboardingBodySchema } from "./onboarding.schema.js";

export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  save = async (req: Request, res: Response) => {
    const body = onboardingBodySchema.parse(req.body);
    await this.service.saveProgress(getAuth(req).userId, body);
    return noContent(res);
  };
}
