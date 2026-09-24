import type { FastifyInstance } from "fastify";
import type { FacebookController } from "./facebook.controller";

export interface FacebookRoutesOptions {
  controller: FacebookController;
}

async function facebookRoutes(
  fastify: FastifyInstance,
  { controller }: FacebookRoutesOptions,
) {
  // Webhook verification handshake, and the OAuth redirect when
  // FB_REDIRECT_URI points here.
  fastify.get("/fb/capture", controller.fbCallback);
  // Leadgen webhook: signature checked on the raw bytes before parsing.
  fastify.post(
    "/fb/capture",
    { config: { rawBody: true }, preHandler: controller.verifySignature },
    controller.capture,
  );
  // OAuth redirect target when FB_REDIRECT_URI points at a dedicated path.
  fastify.get("/fb/auth", controller.oauthCallback);
  // Start of the connect flow (internal: requires x-service-token).
  fastify.get(
    "/fb/connect",
    { preHandler: controller.requireServiceToken },
    controller.connect,
  );
}

export default facebookRoutes;
