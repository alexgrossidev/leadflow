import { Router } from "express";
import { CustomerController } from "./customer.controller.js";

/** Mounted at `/businesses/:businessId/customers`. */
export function createCustomerRouter(controller: CustomerController): Router {
  const router = Router({ mergeParams: true });
  router.get("/", controller.search);
  router.post("/", controller.create);
  router.delete("/", controller.deleteAll);
  router.get("/:customerId", controller.get);
  router.patch("/:customerId", controller.update);
  router.delete("/:customerId", controller.delete);
  return router;
}

/** Mounted at `/businesses/:businessId/customer-fields`. */
export function createCustomerFieldRouter(controller: CustomerController): Router {
  const router = Router({ mergeParams: true });
  router.get("/", controller.listFields);
  router.post("/", controller.createField);
  router.patch("/:fieldId", controller.updateField);
  router.delete("/:fieldId", controller.deleteField);
  return router;
}
