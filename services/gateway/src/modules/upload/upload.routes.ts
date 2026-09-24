import { Router } from "express";
import { CsvLargeUploadController } from "./upload.controller.js";

/** Mounted at `/businesses/:businessId/imports`. */
export function createImportRouter(controller: CsvLargeUploadController): Router {
  const router = Router({ mergeParams: true });
  router.post("/upload-url", controller.requestUpload);
  router.post("/", controller.launch);
  router.get("/", controller.list);
  router.get("/:importJobId", controller.report);
  return router;
}
