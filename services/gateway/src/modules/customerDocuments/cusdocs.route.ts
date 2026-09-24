import { Router } from "express";
import { CustomerDocumentsController } from "./cusdocs.controller.js";

/** Mounted at `/businesses/:businessId/customers/:customerId/documents`. */
export function createCustomerDocumentRouter(controller: CustomerDocumentsController): Router {
  const router = Router({ mergeParams: true });
  router.get("/", controller.list);
  router.post("/", controller.create);
  router.post("/upload-url", controller.requestUpload);
  router.patch("/:documentId", controller.update);
  router.delete("/:documentId", controller.delete);
  router.get("/:documentId/download", controller.download);
  return router;
}
