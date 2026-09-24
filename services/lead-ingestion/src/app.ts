import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { fastifyRawBody } from "fastify-raw-body";
import { ZodError } from "zod";
import { logger } from "#core/logger";

import facebookRoutes from "./modules_inbound/facebook/facebook.routes";
import { createFacebookController } from "./modules_inbound/facebook/facebook.module";
import type { FacebookController } from "./modules_inbound/facebook/facebook.controller";
import googleRoutes from "./modules_inbound/google/google.routes";
import { createGoogleController } from "./modules_inbound/google/google.module";
import type { GoogleController } from "./modules_inbound/google/google.controller";
import healthRoutes from "./modules_inbound/health/health.routes";
import {
  defaultHealthProbes,
  type HealthProbes,
} from "./modules_inbound/health/health.service";

export interface AppDeps {
  facebookController: FacebookController;
  googleController: GoogleController;
  healthProbes: HealthProbes;
}

/**
 * Request logs carry the route path only. Query strings on this service hold
 * OAuth codes, signed state and the webhook verify token, and headers hold
 * signatures and the service token, so neither is ever serialized.
 */
const httpLogger: FastifyBaseLogger = logger.child(
  {},
  {
    serializers: {
      req: (req: FastifyRequest) => ({
        id: req.id,
        method: req.method,
        url: req.url.split("?")[0],
      }),
      res: (res: FastifyReply) => ({ statusCode: res.statusCode }),
    },
  },
);

function errorHandler(
  err: FastifyError | Error,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  if (err instanceof ZodError) {
    return reply.code(400).send({
      error: "Bad Request",
      issues: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  // Our domain errors and Fastify's own (bad JSON, wrong content type, ...)
  // carry a 4xx statusCode and a message that is safe to return.
  const statusCode = (err as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return reply.code(statusCode).send({ error: err.message });
  }

  // Anything else is ours: log it, and never leak internals to the caller.
  req.log.error({ err }, "Unhandled request error");
  return reply.code(500).send({ error: "Internal Server Error" });
}

/**
 * Builds the HTTP app without touching Redis, MySQL or the workers, so tests
 * can `inject` against it with fakes; `main.ts` owns the process lifecycle.
 */
export async function buildApp(
  deps: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: httpLogger });

  app.setErrorHandler(errorHandler);

  // Webhook signatures are computed over the exact bytes received, so the
  // signed routes opt in to keeping the raw body next to the parsed one.
  await app.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
  });

  await app.register(healthRoutes, {
    probes: deps.healthProbes ?? defaultHealthProbes,
  });
  await app.register(facebookRoutes, {
    controller: deps.facebookController ?? createFacebookController(),
  });
  await app.register(googleRoutes, {
    controller: deps.googleController ?? createGoogleController(),
  });

  return app;
}
