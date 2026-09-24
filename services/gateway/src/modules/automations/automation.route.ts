import { Router } from "express";
import { AutomationController } from "./automation.controller.js";

/** Mounted at `/businesses/:businessId/automations`. */
export function createAutomationRouter(controller: AutomationController): Router {
  const router = Router({ mergeParams: true });
  router.post("/", controller.create);
  router.put("/:automationId", controller.update);
  router.put("/:automationId/paused", controller.setPaused);
  router.delete("/:automationId", controller.delete);
  return router;
}
