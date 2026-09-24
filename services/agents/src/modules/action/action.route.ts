import type { Router } from "express";
import { ExtendLeadFlowRoutes } from "#core/apifactory/base.route";
import type { ActionController } from "./action.controller.js";

export const actionRoutes = (controller: ActionController): Router =>
  ExtendLeadFlowRoutes([
    { httpAction: "post", suffix: "/", controllerMethod: controller.create },
    { httpAction: "get", suffix: "/:businessId/:userId", controllerMethod: controller.list },
    { httpAction: "get", suffix: "/:id", controllerMethod: controller.get },
    { httpAction: "delete", suffix: "/:id", controllerMethod: controller.remove },
  ]);
