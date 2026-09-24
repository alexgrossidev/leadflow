import { afterAll, beforeAll, describe, it, expect } from "vitest";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildFakeTransport, type FakeTransportOptions, type SentMessage } from "../../dev/fake-transport";
import { SessionController } from "#modules/sessions/session.controller";
import { SessionService } from "#modules/sessions/session.service";
import { WhatsappClient } from "#transport/whatsapp.client";
import { InMemorySessionCoordinator, InMemorySessionRepository } from "#modules/sessions/__tests__/fakes";
import { buildServer } from "../server";

const SECRET_KEY = "fake-transport-secret-0123456789";
const SERVICE_TOKEN = "service-token-0123456789abcdef";
const WEBHOOK_SECRET = "webhook-secret-0123456789abcdef";

const baseUrl = (app: FastifyInstance) => `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

/**
 * Drives the real client and HTTP layer against dev/fake-transport.ts, so the
 * fake cannot drift from what the service actually calls: start-session must
 * produce webhooks the callback route accepts, and send-message must answer in
 * a shape the client can read an id from.
 */
describe("fake transport contract", () => {
  const fakeOptions: FakeTransportOptions = { secretKey: SECRET_KEY, stepDelayMs: 20 };
  let fake: { app: FastifyInstance; messages: SentMessage[] };
  let service: FastifyInstance;
  let client: WhatsappClient;

  beforeAll(async () => {
    fake = buildFakeTransport(fakeOptions);
    await fake.app.listen({ port: 0, host: "127.0.0.1" });

    client = new WhatsappClient({ baseUrl: baseUrl(fake.app), secretKey: SECRET_KEY, timeoutMs: 2_000 });
    const sessions = new SessionService(new InMemorySessionRepository(), new InMemorySessionCoordinator(), client, {
      reinitSettleMs: 0,
    });
    service = await buildServer({
      controller: new SessionController(sessions, client, 0),
      serviceToken: SERVICE_TOKEN,
      webhookSecret: WEBHOOK_SECRET,
      healthChecks: { transport: () => client.healthCheck() },
    });
    await service.listen({ port: 0, host: "127.0.0.1" });
    fakeOptions.webhookUrl = `${baseUrl(service)}/sessions/callback/${WEBHOOK_SECRET}`;
  });

  afterAll(async () => {
    await service.close();
    await fake.app.close();
  });

  const api = (method: string, path: string) =>
    fetch(`${baseUrl(service)}${path}`, { method, headers: { "x-service-token": SERVICE_TOKEN } });

  async function waitForStatus(status: string, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const body = (await (await api("GET", "/sessions/3/7/status")).json()) as { status: string };
      if (body.status === status) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`session never reached ${status}`);
  }

  it("rejects a wrong secret key and a wrong bearer token", async () => {
    const wrongSecret = new WhatsappClient({ baseUrl: baseUrl(fake.app), secretKey: "not-the-secret-key-000", timeoutMs: 2_000 });
    await expect(wrongSecret.initSession(9, 9)).rejects.toMatchObject({ code: "HTTP_400" });

    const res = await fetch(`${baseUrl(fake.app)}/api/9_9/start-session`, {
      method: "POST",
      headers: { authorization: "Bearer forged" },
    });
    expect(res.status).toBe(401);
  });

  it("start-session plays back qrcode → qrReadSuccess → isLogged and the session connects", async () => {
    const init = await api("POST", "/sessions/3/7");
    expect(init.status).toBe(202);

    await waitForStatus("qr_ready");
    const qr = (await (await api("GET", "/sessions/3/7/qr")).json()) as { qr: string; expiresIn: number };
    expect(qr.qr).toMatch(/^data:image\/png;base64,/);

    await waitForStatus("connected");
    await expect(client.getSessionStatus(3, 7)).resolves.toBe(true);
    await expect(client.healthCheck()).resolves.toBe(true);
  });

  it("send-message returns an id in the upstream shape and the fake records the message", async () => {
    const result = await client.send({
      userId: 7,
      businessId: 3,
      recipientPhone: "15550000001",
      content: { body: "Thanks for your enquiry!" },
      messageLogId: 1,
      idempotencyKey: "whatsapp:1:2:15550000001:abc",
    });

    expect(result.providerMessageId).toMatch(/^true_15550000001@c\.us_/);
    const listed = (await (await fetch(`${baseUrl(fake.app)}/__messages`)).json()) as SentMessage[];
    expect(listed).toEqual([expect.objectContaining({ id: result.providerMessageId, session: "3_7", message: "Thanks for your enquiry!" })]);
  });

  it("send-message on a closed session is a retriable SESSION_DISCONNECTED error", async () => {
    const closed = await api("DELETE", "/sessions/3/7");
    expect(closed.status).toBe(204);

    await expect(
      client.send({ userId: 7, businessId: 3, recipientPhone: "1555", content: { body: "x" }, messageLogId: 2, idempotencyKey: "k2" }),
    ).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
  });
});
