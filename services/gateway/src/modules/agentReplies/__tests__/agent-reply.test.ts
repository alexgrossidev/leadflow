import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { globalErrorHandler } from "#core/middleware/error-handler";
import { createAgentReplyRouter, toWhatsappRequest } from "../agent-reply.js";

const TOKEN = process.env.SERVICE_TOKEN!;

function app(owns = true) {
  const emit = vi.fn(async () => "job");
  const server = express();
  server.use(express.json());
  server.use(
    "/internal/agents",
    createAgentReplyRouter({ businessBelongsToUser: async () => owns, emit }),
  );
  server.use(globalErrorHandler);
  return { server, emit };
}

const body = { businessId: 7, userId: 3, conversationId: "393331234567@c.us", message: "Ciao! We open at 9." };

describe("toWhatsappRequest", () => {
  it("normalises both chat id formats to the same E.164 recipient and key", () => {
    const a = toWhatsappRequest({ ...body, conversationId: "393331234567@c.us" });
    const b = toWhatsappRequest({ ...body, conversationId: "+393331234567" });
    expect(a.recipientPhone).toBe("+393331234567");
    expect(a).toEqual(b);
  });

  it("keeps the phone number out of the idempotency key", () => {
    expect(toWhatsappRequest(body).idempotencyKey).not.toContain("393331234567");
  });

  it("gives a different key to a different message", () => {
    expect(toWhatsappRequest(body).idempotencyKey).not.toBe(
      toWhatsappRequest({ ...body, message: "Another reply" }).idempotencyKey,
    );
  });
});

describe("POST /internal/agents/whatsapp/send", () => {
  it("rejects calls without the service token", async () => {
    const { server, emit } = app();
    await request(server).post("/internal/agents/whatsapp/send").send(body).expect(401);
    expect(emit).not.toHaveBeenCalled();
  });

  it("queues the reply on the whatsapp delivery path", async () => {
    const { server, emit } = app();
    const res = await request(server)
      .post("/internal/agents/whatsapp/send")
      .set("x-service-token", TOKEN)
      .send(body)
      .expect(202);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 7, recipientPhone: "+393331234567", content: { body: body.message } }),
      res.body.idempotencyKey,
    );
  });

  it("rejects a conversation id that is not a WhatsApp chat", async () => {
    const { server } = app();
    await request(server)
      .post("/internal/agents/whatsapp/send")
      .set("x-service-token", TOKEN)
      .send({ ...body, conversationId: "../../etc/passwd" })
      .expect(400);
  });

  it("refuses to send for a business the user does not own", async () => {
    const { server, emit } = app(false);
    await request(server)
      .post("/internal/agents/whatsapp/send")
      .set("x-service-token", TOKEN)
      .send(body)
      .expect(422);
    expect(emit).not.toHaveBeenCalled();
  });
});
