import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, type HealthCheck } from "../../../server";
import { SessionController } from "../session.controller";
import { createTestService } from "./fakes";

const SERVICE_TOKEN = "service-token-0123456789abcdef";
const WEBHOOK_SECRET = "webhook-secret-0123456789abcdef";

async function setup(healthChecks: Record<string, HealthCheck> = { database: async () => true }) {
  const ctx = createTestService();
  const probe = { getSessionStatus: vi.fn().mockResolvedValue(false) };
  const app = await buildServer({
    controller: new SessionController(ctx.service, probe, 0),
    serviceToken: SERVICE_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    healthChecks,
    healthTimeoutMs: 50,
  });
  return { ...ctx, app };
}

const auth = { "x-service-token": SERVICE_TOKEN };

describe("session API authentication", () => {
  let app: FastifyInstance;
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
    app = ctx.app;
    ctx.repo.seed({ businessId: 1, userId: 2, status: "qr_ready", qrCode: "data:image/png;base64,qr", qrExpiresAt: new Date(Date.now() + 60_000) });
  });

  afterEach(async () => {
    await app.close();
  });

  const routes = [
    { method: "POST", url: "/sessions/1/2" },
    { method: "GET", url: "/sessions/1/2/status" },
    { method: "GET", url: "/sessions/1/2/qr" },
    { method: "DELETE", url: "/sessions/1/2" },
  ] as const;

  it.each(routes)("$method $url rejects a missing or wrong service token", async ({ method, url }) => {
    for (const headers of [{}, { "x-service-token": "wrong" }, { "x-service-token": `${SERVICE_TOKEN}x` }]) {
      const res = await app.inject({ method, url, headers });
      expect(res.statusCode).toBe(401);
    }
    expect(ctx.repo.get(1, 2)!.status).toBe("qr_ready");
    expect(ctx.transport.initSession).not.toHaveBeenCalled();
  });

  it("a valid token reaches the handlers", async () => {
    const qr = await app.inject({ method: "GET", url: "/sessions/1/2/qr", headers: auth });
    expect(qr.statusCode).toBe(200);
    expect(qr.json()).toMatchObject({ qr: "data:image/png;base64,qr" });

    const init = await app.inject({ method: "POST", url: "/sessions/3/4", headers: auth });
    expect(init.statusCode).toBe(202);

    const del = await app.inject({ method: "DELETE", url: "/sessions/1/2", headers: auth });
    expect(del.statusCode).toBe(204);
    expect(ctx.repo.get(1, 2)!.status).toBe("closed");
  });

  it.each(["0", "-1", "abc", "1.5", "01", "99999999999", "2147483648"])(
    "rejects a malformed id %s with 400",
    async (bad) => {
      for (const url of [`/sessions/${bad}/2`, `/sessions/1/${bad}/status`, `/sessions/${bad}/2/qr`]) {
        const res = await app.inject({ method: url.endsWith("2") ? "POST" : "GET", url, headers: auth });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ code: "INVALID_PARAMS" });
      }
    },
  );
});

describe("webhook callback authentication", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
    ctx.repo.seed({ businessId: 1, userId: 2, status: "connecting" });
  });

  afterEach(async () => {
    await ctx.app.close();
  });

  const qrWebhook = { event: "qrcode", session: "1_2", qrcode: "iVBORw0KGgo" };

  it("accepts the secret in the URL path without a service token", async () => {
    const res = await ctx.app.inject({ method: "POST", url: `/sessions/callback/${WEBHOOK_SECRET}`, payload: qrWebhook });

    expect(res.statusCode).toBe(200);
    expect(ctx.repo.get(1, 2)).toMatchObject({ status: "qr_ready", qrCode: "data:image/png;base64,iVBORw0KGgo" });
  });

  it("accepts the secret in the X-Webhook-Secret header", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/sessions/callback",
      headers: { "x-webhook-secret": WEBHOOK_SECRET },
      payload: qrWebhook,
    });

    expect(res.statusCode).toBe(200);
    expect(ctx.repo.get(1, 2)!.status).toBe("qr_ready");
  });

  it("rejects a wrong or missing secret before touching any session", async () => {
    const attempts = [
      { url: "/sessions/callback/wrong-secret" },
      { url: `/sessions/callback/${WEBHOOK_SECRET.slice(0, -1)}` },
      { url: "/sessions/callback" },
      { url: "/sessions/callback", headers: { "x-webhook-secret": "wrong" } },
      // The service token is not a webhook secret.
      { url: `/sessions/callback/${SERVICE_TOKEN}`, headers: auth },
    ];
    for (const attempt of attempts) {
      const res = await ctx.app.inject({ method: "POST", payload: qrWebhook, ...attempt });
      expect(res.statusCode).toBe(401);
    }
    expect(ctx.repo.get(1, 2)!.status).toBe("connecting");
  });

  it("rejects a body whose session is not <businessId>_<userId>", async () => {
    for (const session of ["", "1", "a_b", "1_2_3", "0_2"]) {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/sessions/callback/${WEBHOOK_SECRET}`,
        payload: { event: "qrcode", session },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe("GET /health", () => {
  it("returns 200 when every dependency answers", async () => {
    const { app } = await setup({ database: async () => undefined, redis: async () => "PONG", transport: async () => true });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", checks: { database: "ok", redis: "ok", transport: "ok" } });
    await app.close();
  });

  it("returns 503 when a dependency fails, reports unhealthy or hangs", async () => {
    const { app } = await setup({
      database: async () => {
        throw new Error("ECONNREFUSED");
      },
      redis: () => new Promise(() => undefined),
      transport: async () => false,
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: "degraded", checks: { database: "fail", redis: "fail", transport: "fail" } });
    await app.close();
  });
});
