import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { logger } from "@leadflow/shared";
import type { SessionController } from "#modules/sessions/session.controller";
import { sessionRoutes } from "#modules/sessions/session.routes";

/** A dependency probe: resolves when healthy, rejects or resolves false when not. */
export type HealthCheck = () => Promise<unknown>;

export interface ServerDeps {
  controller: SessionController;
  serviceToken: string;
  webhookSecret: string;
  healthChecks: Record<string, HealthCheck>;
  healthTimeoutMs?: number;
}

async function runCheck(check: HealthCheck, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    const result = await Promise.race([check().then((value) => value !== false), timeout]);
    return result;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  // Fastify's own request logging is off: it would log webhook URLs, which
  // carry the webhook secret in their path.
  const app = Fastify({ logger: false });

  app.setErrorHandler<FastifyError>((err, request, reply) => {
    const statusCode = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (statusCode >= 500) {
      logger.error({ err, method: request.method, route: request.routeOptions.url }, "Unhandled request error");
    }
    return reply.status(statusCode).send({
      error: statusCode >= 500 ? "Internal server error" : err.message,
      code: statusCode >= 500 ? "INTERNAL_ERROR" : (err.code ?? "BAD_REQUEST"),
      statusCode,
    });
  });

  // Cheap dependency probes in parallel, each bounded by a short timeout.
  app.get("/health", async (_request, reply) => {
    const timeoutMs = deps.healthTimeoutMs ?? 2_000;
    const names = Object.keys(deps.healthChecks);
    const results = await Promise.all(names.map((name) => runCheck(deps.healthChecks[name]!, timeoutMs)));

    const checks = Object.fromEntries(names.map((name, i) => [name, results[i] ? "ok" : "fail"]));
    const healthy = results.every(Boolean);
    return reply.status(healthy ? 200 : 503).send({ status: healthy ? "ok" : "degraded", checks });
  });

  await app.register(sessionRoutes, {
    controller: deps.controller,
    serviceToken: deps.serviceToken,
    webhookSecret: deps.webhookSecret,
  });

  return app;
}
