import type { Router } from "express";
import { ExtendLeadFlowRoutes } from "#core/apifactory/base.route";
import type { OnboardingController } from "./onboarding.controller.js";

export const onboardingRoutes = (controller: OnboardingController): Router =>
  ExtendLeadFlowRoutes([
    { httpAction: "post", suffix: "/", controllerMethod: controller.onboard },
  ]);
