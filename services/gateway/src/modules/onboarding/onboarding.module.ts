import { OnboardingRepository } from "./onboarding.repo.js";
import { OnboardingService } from "./onboarding.service.js";
import { OnboardingController } from "./onboarding.controller.js";

const repo = new OnboardingRepository();
const service = new OnboardingService(repo);
export const onboardingController = new OnboardingController(service);
