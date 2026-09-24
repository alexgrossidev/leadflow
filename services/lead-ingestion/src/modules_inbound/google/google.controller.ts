import type { FastifyRequest, FastifyReply } from "fastify";
import type { GoogleService } from "./google.service";
import { GoogleLeadWebhookPayloadSchema } from "./google.schema";
import { GOOGLE_SIGNATURE_HEADER } from "./google.signature";

export class GoogleController {
  constructor(private service: GoogleService) {}

  /** preHandler: verify the request really came from the relay before parsing it. */
  verifySignature = async (req: FastifyRequest) => {
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer | string })
      .rawBody;
    this.service.assertValidSignature(
      rawBody,
      req.headers[GOOGLE_SIGNATURE_HEADER],
    );
  };

  capture = async (req: FastifyRequest, reply: FastifyReply) => {
    const payload = GoogleLeadWebhookPayloadSchema.parse(req.body);
    // Screen (honeypot/replay/content/rate/duplicate) then enqueue. Always ACK
    // 200: a dropped spam submission must not tell a bot which check caught it.
    await this.service.captureLead(payload);
    return reply.code(200).send();
  };
}
