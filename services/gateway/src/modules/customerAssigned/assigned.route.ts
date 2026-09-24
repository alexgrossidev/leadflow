import { Router } from "express";
import { CustomerAssignedServicesController } from "./assigned.controller.js";

/** Mounted at `/businesses/:businessId/customers/:customerId/services`. */
export function createAssignedServicesRouter(
  controller: CustomerAssignedServicesController,
): Router {
  const router = Router({ mergeParams: true });
  router.get("/", controller.list);
  router.post("/", controller.assign);
  router.put("/", controller.replace);
  router.delete("/:serviceId", controller.unassign);
  return router;
}
