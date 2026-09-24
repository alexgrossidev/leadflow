import { Router } from "express";
import { requireServiceToken } from "#core/middleware/service-token";
import { LeadController } from "./lead.controller.js";

/** Mounted at `/businesses/:businessId/leads`. */
export function createLeadRouter(controller: LeadController): Router {
  const router = Router({ mergeParams: true });
  router.post("/", controller.create);
  router.patch("/:leadId", controller.update);
  return router;
}

/** Mounted at `/internal`, outside the user auth wall; service token only. */
export function createInternalRouter(controller: LeadController): Router {
  const router = Router();
  router.use(requireServiceToken);
  router.post("/leads", controller.intake);
  return router;
}
