import { Router } from "express";
import { CustomerNoteController } from "./cusnotes.controller.js";

/** Mounted at `/businesses/:businessId/customers/:customerId/notes`. */
export function createCustomerNoteRouter(controller: CustomerNoteController): Router {
  const router = Router({ mergeParams: true });
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.patch("/:noteId", controller.update);
  router.delete("/:noteId", controller.delete);
  return router;
}
