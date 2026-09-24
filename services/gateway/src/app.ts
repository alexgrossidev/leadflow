import express, { Router } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { env } from "#config/env";
import { globalErrorHandler } from "#core/middleware/error-handler";
import { authenticate, requireBusinessAccess } from "#core/middleware/auth-middleware";

import { authController } from "./modules/auth/auth.module.js";
import { createAuthRouter } from "./modules/auth/auth.route.js";
import { businessController } from "./modules/business/business.module.js";
import {
  createBusinessCollectionRouter,
  createBusinessRouter,
} from "./modules/business/business.route.js";
import { customerController } from "./modules/customers/customer.module.js";
import {
  createCustomerFieldRouter,
  createCustomerRouter,
} from "./modules/customers/customer.route.js";
import { notesController } from "./modules/customerNotes/cusnotes.module.js";
import { createCustomerNoteRouter } from "./modules/customerNotes/cusnotes.route.js";
import { docsController } from "./modules/customerDocuments/cusdocs.module.js";
import { createCustomerDocumentRouter } from "./modules/customerDocuments/cusdocs.route.js";
import { customerAssignedController } from "./modules/customerAssigned/assigned.module.js";
import { createAssignedServicesRouter } from "./modules/customerAssigned/assigned.route.js";
import { businessServiceController } from "./modules/services/services.module.js";
import { createServicesRouter } from "./modules/services/services.route.js";
import { leadController, leadRepository } from "./modules/lead/lead.module.js";
import { createAgentReplyRouter } from "./modules/agentReplies/agent-reply.js";
import { createInternalRouter, createLeadRouter } from "./modules/lead/lead.route.js";
import { automationController } from "./modules/automations/automation.module.js";
import { createAutomationRouter } from "./modules/automations/automation.route.js";
import { automationSettingsController } from "./modules/automationSettings/automationSettings.module.js";
import { createAutomationSettingsRouter } from "./modules/automationSettings/automationSettings.route.js";
import { whatsappNumberController } from "./modules/whatsappNumber/whatsappNumber.module.js";
import { createWhatsappNumberRouter } from "./modules/whatsappNumber/whatsappNumber.route.js";
import { uploadController } from "./modules/upload/upload.module.js";
import { createImportRouter } from "./modules/upload/upload.routes.js";
import { onboardingController } from "./modules/onboarding/onboarding.module.js";
import { createOnboardingRouter } from "./modules/onboarding/onboarding.route.js";

/**
 * Everything a user does inside one business lives under
 * `/businesses/:businessId/...`; the guard in front of this router is the
 * only place that decides whether the caller may act on that business.
 */
function createBusinessScopedRouter(): Router {
  const router = Router({ mergeParams: true });
  router.use("/customers/:customerId/notes", createCustomerNoteRouter(notesController));
  router.use("/customers/:customerId/documents", createCustomerDocumentRouter(docsController));
  router.use(
    "/customers/:customerId/services",
    createAssignedServicesRouter(customerAssignedController),
  );
  router.use("/customers", createCustomerRouter(customerController));
  router.use("/customer-fields", createCustomerFieldRouter(customerController));
  router.use("/services", createServicesRouter(businessServiceController));
  router.use("/leads", createLeadRouter(leadController));
  router.use("/automations", createAutomationRouter(automationController));
  router.use(
    "/automation-settings",
    createAutomationSettingsRouter(automationSettingsController),
  );
  router.use("/whatsapp-numbers", createWhatsappNumberRouter(whatsappNumberController));
  router.use("/imports", createImportRouter(uploadController));
  router.use("/", createBusinessRouter(businessController));
  return router;
}

export function createApp() {
  const app = express();

  // Behind one reverse proxy (the demo's compose network / a load balancer),
  // so req.ip is the client address used by the login rate limiter.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    cors({
      origin: env.ALLOWED_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    }),
  );
  app.use(helmet());
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  // ─── Public ───────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.status(200).json({ success: true, data: { status: "ok" } });
  });
  app.use("/auth", createAuthRouter(authController));

  // ─── Service-to-service (x-service-token) ─────────────────────────────────
  app.use(
    "/internal/agents",
    createAgentReplyRouter({
      businessBelongsToUser: (businessId, userId) => leadRepository.businessBelongsToUser(businessId, userId),
    }),
  );
  app.use("/internal", createInternalRouter(leadController));

  // ─── Global auth wall: everything below needs a valid access token ────────
  app.use(authenticate);

  app.use("/onboarding", createOnboardingRouter(onboardingController));
  app.use("/businesses", createBusinessCollectionRouter(businessController));
  app.use("/businesses/:businessId", requireBusinessAccess, createBusinessScopedRouter());

  app.use((_req, res) => {
    res.status(404).json({ success: false, code: "NOT_FOUND", message: "Route not found" });
  });
  app.use(globalErrorHandler);

  return app;
}
