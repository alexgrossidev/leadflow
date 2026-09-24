import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { secretMatches } from "#core/auth";
import { logger } from "@leadflow/shared";
import { callbackBodySchema, type SessionController } from "./session.controller";

export interface SessionRoutesOptions {
  controller: SessionController;
  /** Required in `x-service-token` on every /sessions route except the webhook. */
  serviceToken: string;
  /** Required in the webhook path (`/sessions/callback/<secret>`) or `x-webhook-secret`. */
  webhookSecret: string;
}

const MAX_INT = 2_147_483_647;
const idParam = z
  .string()
  .regex(/^[1-9]\d{0,9}$/)
  .transform(Number)
  .refine((n) => n <= MAX_INT);

const sessionParamsSchema = z.object({ business_id: idParam, user_id: idParam });

function unauthorized(reply: FastifyReply, message: string) {
  return reply.status(401).send({ error: message, code: "UNAUTHORIZED", statusCode: 401 });
}

function badRequest(reply: FastifyReply, code: string, message: string) {
  return reply.status(400).send({ error: message, code, statusCode: 400 });
}

/** Parse `:business_id/:user_id`, replying 400 and returning null when invalid. */
function parseSessionParams(params: unknown, reply: FastifyReply): { businessId: number; userId: number } | null {
  const parsed = sessionParamsSchema.safeParse(params);
  if (!parsed.success) {
    void badRequest(reply, "INVALID_PARAMS", "business_id and user_id must be positive integers");
    return null;
  }
  return { businessId: parsed.data.business_id, userId: parsed.data.user_id };
}

export async function sessionRoutes(app: FastifyInstance, opts: SessionRoutesOptions): Promise<void> {
  const { controller } = opts;

  // ── Tenant-facing session API: service token required ──────────────────────
  await app.register(async (api) => {
    api.addHook("onRequest", async (request, reply) => {
      if (!secretMatches(request.headers["x-service-token"], opts.serviceToken)) {
        return unauthorized(reply, "Invalid or missing service token");
      }
    });

    /** Start a session. 202 while WPPConnect boots; poll /qr for the code. */
    api.post("/sessions/:business_id/:user_id", async (request, reply) => {
      const ids = parseSessionParams(request.params, reply);
      if (!ids) return reply;

      const result = await controller.initSession(ids.businessId, ids.userId);
      if ("httpError" in result) return reply.status(result.httpError.statusCode).send(result.httpError);

      return reply.status(202).send({
        sessionId: result.session.id,
        status: result.session.status,
        message: "Session initialising; poll /qr for the QR code",
      });
    });

    api.get("/sessions/:business_id/:user_id/status", async (request, reply) => {
      const ids = parseSessionParams(request.params, reply);
      if (!ids) return reply;

      const result = await controller.getStatus(ids.businessId, ids.userId);
      if ("httpError" in result) return reply.status(result.httpError.statusCode).send(result.httpError);
      return reply.status(200).send(result.status);
    });

    api.get("/sessions/:business_id/:user_id/qr", async (request, reply) => {
      const ids = parseSessionParams(request.params, reply);
      if (!ids) return reply;

      const result = await controller.getQr(ids.businessId, ids.userId);
      if ("httpError" in result) return reply.status(result.httpError.statusCode).send(result.httpError);
      return reply.status(200).send(result.qr);
    });

    api.delete("/sessions/:business_id/:user_id", async (request, reply) => {
      const ids = parseSessionParams(request.params, reply);
      if (!ids) return reply;

      const result = await controller.closeSession(ids.businessId, ids.userId);
      if (result && "httpError" in result) return reply.status(result.httpError.statusCode).send(result.httpError);
      return reply.status(204).send();
    });
  });

  // ── wppconnect-server webhook: authenticated by its own secret ─────────────
  // Stock wppconnect-server cannot add custom headers, so the secret normally
  // travels in the path. The header form is accepted for proxies that can set it.
  const handleCallback = async (secret: unknown, body: unknown, reply: FastifyReply) => {
    if (!secretMatches(secret, opts.webhookSecret)) {
      logger.warn("Webhook callback rejected: invalid or missing secret");
      return unauthorized(reply, "Invalid or missing webhook secret");
    }

    const parsed = callbackBodySchema.safeParse(body);
    if (!parsed.success) return badRequest(reply, "INVALID_CALLBACK", "Callback body must include event and session");

    const normalised = controller.normaliseCallbackEvent(parsed.data);
    if (normalised.kind === "inbound_message") {
      await controller.handleInboundMessage(normalised.businessId, normalised.userId);
    } else if (normalised.kind === "session") {
      try {
        await controller.handleSessionCallback(normalised.payload);
      } catch (err) {
        // Always 200: wppconnect does not retry, and a 5xx only adds noise upstream.
        logger.error({ err, event: parsed.data.event, session: parsed.data.session }, "Session callback failed");
      }
    }
    return reply.status(200).send({ ok: true });
  };

  app.post<{ Params: { secret: string } }>("/sessions/callback/:secret", (request, reply) =>
    handleCallback(request.params.secret, request.body, reply),
  );

  app.post("/sessions/callback", (request, reply) =>
    handleCallback(request.headers["x-webhook-secret"], request.body, reply),
  );
}
