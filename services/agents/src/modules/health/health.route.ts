import type { Router } from "express";
import { ExtendLeadFlowRoutes } from "#core/apifactory/base.route";
import type { HealthController } from "./health.controller.js";

export const healthRoutes = (controller: HealthController): Router =>
  ExtendLeadFlowRoutes([
    { httpAction: "get", suffix: "/", controllerMethod: controller.check },
  ]);
