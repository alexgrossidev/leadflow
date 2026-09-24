import { Router } from "express";
import { OnboardingController } from "./onboarding.controller.js";

/** Mounted at `/onboarding`; always acts on the authenticated user. */
export function createOnboardingRouter(controller: OnboardingController): Router {
  const router = Router();
  router.put("/", controller.save);
  return router;
}
