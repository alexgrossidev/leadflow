import express, { type Express } from "express";
import helmet from "helmet";
import { createErrorHandler } from "#core/middleware/error-handler";
import { createServiceAuth } from "#core/middleware/service-auth";
import { ActionController } from "#modules/action/action.controller";
import { actionRoutes } from "#modules/action/action.route";
import type { ActionService } from "#modules/action/action.service";
import { AgentConfigController } from "#modules/agent-config/agent-config.controller";
import { agentConfigRoutes } from "#modules/agent-config/agent-config.route";
import type { AgentConfigService } from "#modules/agent-config/agent-config.service";
import { HealthController } from "#modules/health/health.controller";
import { healthRoutes } from "#modules/health/health.route";
import type { HealthService } from "#modules/health/health.service";
import { OnboardingController } from "#modules/onboarding/onboarding.controller";
import { onboardingRoutes } from "#modules/onboarding/onboarding.route";
import type { OnboardingService } from "#modules/onboarding/onboarding.service";

export interface AppDeps {
  serviceToken: string;
  /** Include internal error messages in 500 responses (never in production). */
  exposeInternalErrors: boolean;
  actions: ActionService;
  agentConfigs: AgentConfigService;
  onboarding: OnboardingService;
  health: HealthService;
}

/**
 * Builds the HTTP app from its services, so tests can mount it with in-memory
 * stores and a fake LLM. No CORS: this is a service-to-service API called by
 * the gateway, never by a browser.
 */
export const createApp = (deps: AppDeps): Express => {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());

  const auth = createServiceAuth(deps.serviceToken);

  app.use("/health", healthRoutes(new HealthController(deps.health)));

  // The knowledge base is capped at 50k characters; 256kb leaves room for
  // JSON escaping of multi-byte text without admitting anything larger.
  app.use(
    "/agents",
    auth,
    express.json({ limit: "256kb" }),
    agentConfigRoutes(new AgentConfigController(deps.agentConfigs)),
  );
  app.use(
    "/actions",
    auth,
    express.json({ limit: "1mb" }),
    actionRoutes(new ActionController(deps.actions)),
  );
  app.use(
    "/onboarding",
    auth,
    express.json({ limit: "1mb" }),
    onboardingRoutes(new OnboardingController(deps.onboarding)),
  );

  app.use(createErrorHandler({ exposeInternalErrors: deps.exposeInternalErrors }));
  return app;
};
