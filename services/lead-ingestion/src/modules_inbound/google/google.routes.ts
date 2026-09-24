import type { FastifyInstance } from "fastify";
import type { GoogleController } from "./google.controller";

export interface GoogleRoutesOptions {
  controller: GoogleController;
}

async function googleRoutes(
  fastify: FastifyInstance,
  { controller }: GoogleRoutesOptions,
) {
  // Signed Google Form submissions pushed by the relay; HMAC checked on raw bytes.
  fastify.post(
    "/google/capture",
    { config: { rawBody: true }, preHandler: controller.verifySignature },
    controller.capture,
  );
}

export default googleRoutes;
