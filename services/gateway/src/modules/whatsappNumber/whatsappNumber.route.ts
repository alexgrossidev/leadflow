import { Router } from "express";
import { WhatsappNumberController } from "./whatsappNumber.controller.js";

/** Mounted at `/businesses/:businessId/whatsapp-numbers`. */
export function createWhatsappNumberRouter(controller: WhatsappNumberController): Router {
  const router = Router({ mergeParams: true });
  router.post("/", controller.add);
  router.delete("/:phoneNumber", controller.remove);
  return router;
}
