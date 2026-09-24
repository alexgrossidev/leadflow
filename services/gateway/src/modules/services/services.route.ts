import { Router } from "express";
import { BusinessServiceController } from "./services.controller.js";

/** Mounted at `/businesses/:businessId/services`. */
export function createServicesRouter(controller: BusinessServiceController): Router {
  const router = Router({ mergeParams: true });
  router.get("/", controller.list);
  return router;
}
