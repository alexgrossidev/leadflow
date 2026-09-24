import type { FastifyInstance, FastifyReply } from "fastify";
import type { HealthProbes } from "./health.service";

export interface HealthRoutesOptions {
  probes: HealthProbes;
}

const report = (reply: FastifyReply, ok: boolean) =>
  reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "down" });

/**
 * `/health` is liveness (the process answers); the others are readiness probes
 * that return 503 when their dependency is unreachable, so an orchestrator can
 * stop routing webhooks to an instance that cannot enqueue or persist them.
 */
async function healthRoutes(
  fastify: FastifyInstance,
  { probes }: HealthRoutesOptions,
) {
  fastify.get("/health", async (_req, reply) => report(reply, true));
  fastify.get("/health/redis", async (_req, reply) =>
    report(reply, await probes.redis()),
  );
  fastify.get("/health/db", async (_req, reply) =>
    report(reply, await probes.db()),
  );
  fastify.get("/health/ready", async (_req, reply) => {
    const [redis, db] = await Promise.all([probes.redis(), probes.db()]);
    return reply
      .code(redis && db ? 200 : 503)
      .send({ status: redis && db ? "ok" : "down", redis, db });
  });
}

export default healthRoutes;
