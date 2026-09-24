import { OnboardingRepository } from "./onboarding.repo.js";
import { OnboardingBody } from "./onboarding.schema.js";

export class OnboardingService {
  constructor(private repo: OnboardingRepository) {}

  async saveProgress(userId: number, body: OnboardingBody): Promise<void> {
    await this.repo.upsert({
      userId,
      tempId: body.tempId,
      data: body.data,
      completed: body.action === "complete",
    });
  }
}
