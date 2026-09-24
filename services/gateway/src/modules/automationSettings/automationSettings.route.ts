import { Router } from "express";
import { AutomationSettingsController } from "./automationSettings.controller.js";

/** Mounted at `/businesses/:businessId/automation-settings`. */
export function createAutomationSettingsRouter(controller: AutomationSettingsController): Router {
  const router = Router({ mergeParams: true });
  router.post("/", controller.create);
  router.put("/", controller.update);
  router.delete("/", controller.delete);
  return router;
}
