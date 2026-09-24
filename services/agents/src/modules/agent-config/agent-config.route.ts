import type { Router } from "express";
import { ExtendLeadFlowRoutes } from "#core/apifactory/base.route";
import type { AgentConfigController } from "./agent-config.controller.js";

export const agentConfigRoutes = (controller: AgentConfigController): Router =>
  ExtendLeadFlowRoutes([
    { httpAction: "put", suffix: "/:businessId/:userId/config", controllerMethod: controller.upsert },
    { httpAction: "get", suffix: "/:businessId/:userId/config", controllerMethod: controller.get },
  ]);
