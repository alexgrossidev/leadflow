import { Router } from "express";
import { BusinessController } from "./business.controller.js";

/** `/businesses` — collection routes, scoped to the authenticated user. */
export function createBusinessCollectionRouter(controller: BusinessController): Router {
  const router = Router();
  router.get("/", controller.list);
  router.post("/", controller.create);
  return router;
}

/** `/businesses/:businessId` — mounted behind the business guard. */
export function createBusinessRouter(controller: BusinessController): Router {
  const router = Router({ mergeParams: true });
  router.get("/", controller.get);
  router.patch("/", controller.update);
  router.delete("/", controller.delete);
  return router;
}
