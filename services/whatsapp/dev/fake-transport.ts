/**
 * DEV ONLY: an in-memory stand-in for wppconnect-server, so the demo and the
 * contract test can run without Chromium or a real WhatsApp account.
 *
 * It implements exactly the endpoints src/transport/whatsapp.client.ts calls,
 * with the upstream response shapes, and after start-session it plays back the
 * webhooks a real phone login produces:
 *   qrcode → status-find:qrReadSuccess → status-find:isLogged
 * Sent messages are kept in memory and listed at GET /__messages.
 *
 *   SECRET_KEY=... WEBHOOK_URL=http://localhost:3012/sessions/callback/<secret> npm run fake-transport
 *
 * Env: SECRET_KEY (required), WEBHOOK_URL, FAKE_WA_PORT (21465),
 * FAKE_WA_STEP_MS (1500): gap between webhooks, long enough to see the QR.
 */
import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

export interface FakeTransportOptions {
  secretKey: string;
  /** Read on every webhook, so it may be set after the fake is built. */
  webhookUrl?: string;
  stepDelayMs?: number;
}

export interface SentMessage {
  id: string;
  session: string;
  phone: string;
  message: string;
  sentAt: string;
}

// A 1x1 transparent PNG: a valid image the frontend can render as the "QR".
const PLACEHOLDER_QR =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type SessionParams = { session: string; secret?: string };

export function buildFakeTransport(opts: FakeTransportOptions): { app: FastifyInstance; messages: SentMessage[] } {
  const app = Fastify({ logger: false });
  const tokens = new Map<string, string>();
  const connected = new Set<string>();
  const starting = new Set<string>();
  const messages: SentMessage[] = [];
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const postWebhook = async (body: Record<string, unknown>) => {
    if (!opts.webhookUrl) return;
    try {
      await fetch(opts.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      console.warn(`[fake-transport] webhook delivery failed for event ${String(body.event)}`);
    }
  };

  const playLogin = async (session: string) => {
    const steps = [
      { event: "qrcode", qrcode: PLACEHOLDER_QR, urlcode: `fake-qr:${session}` },
      { event: "status-find", status: "qrReadSuccess" },
      { event: "status-find", status: "isLogged" },
    ];
    for (const step of steps) {
      await sleep(opts.stepDelayMs ?? 1500);
      if (step.status === "isLogged") connected.add(session);
      await postWebhook({ ...step, session });
    }
    starting.delete(session);
  };

  const badSecret = { response: false, message: "The SECRET_KEY is incorrect" };

  app.get("/healthz", async () => ({ message: "OK" }));
  app.get("/__messages", async () => messages);

  app.post<{ Params: SessionParams }>("/api/:session/:secret/generate-token", async (req, reply) => {
    if (req.params.secret !== opts.secretKey) return reply.status(400).send(badSecret);
    const token = randomBytes(16).toString("hex");
    tokens.set(req.params.session, token);
    return reply.status(201).send({ status: "success", session: req.params.session, token, full: `${req.params.session}:${token}` });
  });

  app.post<{ Params: SessionParams }>("/api/:session/:secret/clear-session-data", async (req, reply) => {
    if (req.params.secret !== opts.secretKey) return reply.status(400).send(badSecret);
    tokens.delete(req.params.session);
    connected.delete(req.params.session);
    return { success: true };
  });

  app.register(async (api) => {
    api.addHook("preHandler", async (req, reply) => {
      const { session } = req.params as SessionParams;
      const token = tokens.get(session);
      if (!token || req.headers.authorization !== `Bearer ${token}`) {
        return reply.status(401).send({ message: "Unauthorized" });
      }
    });

    api.post<{ Params: SessionParams }>("/api/:session/start-session", async (req) => {
      const { session } = req.params;
      if (connected.has(session)) return { status: "CONNECTED", session };
      if (!starting.has(session)) {
        starting.add(session);
        void playLogin(session);
      }
      return { status: "INITIALIZING", qrcode: null, session };
    });

    api.get<{ Params: SessionParams }>("/api/:session/check-connection-session", async (req) => {
      const isConnected = connected.has(req.params.session);
      return { status: isConnected, message: isConnected ? "Connected" : "Disconnected" };
    });

    api.post<{ Params: SessionParams }>("/api/:session/close-session", async (req) => {
      connected.delete(req.params.session);
      return { status: true, message: "Session successfully closed" };
    });

    api.post<{ Params: SessionParams; Body: { phone?: string; message?: string } }>(
      "/api/:session/send-message",
      async (req, reply) => {
        const { session } = req.params;
        if (!connected.has(session)) {
          return reply.status(404).send({ response: null, status: "Disconnected", message: "Session is not active" });
        }
        const phone = String(req.body?.phone ?? "");
        const id = `true_${phone}@c.us_${randomBytes(10).toString("hex").toUpperCase()}`;
        messages.push({ id, session, phone, message: String(req.body?.message ?? ""), sentAt: new Date().toISOString() });
        // Upstream shape: `response` is an array with one entry per recipient.
        return reply.status(201).send({ status: "success", response: [{ id, to: `${phone}@c.us`, ack: 1 }], session });
      },
    );
  });

  return { app, messages };
}

if (process.argv[1]?.endsWith("fake-transport.ts")) {
  const secretKey = process.env.SECRET_KEY;
  if (!secretKey) {
    console.error("[fake-transport] SECRET_KEY is required");
    process.exit(1);
  }
  const port = Number(process.env.FAKE_WA_PORT ?? 21465);
  const { app } = buildFakeTransport({
    secretKey,
    ...(process.env.WEBHOOK_URL ? { webhookUrl: process.env.WEBHOOK_URL } : {}),
    stepDelayMs: Number(process.env.FAKE_WA_STEP_MS ?? 1500),
  });
  app.listen({ port, host: "0.0.0.0" }).then(
    () => console.log(`[fake-transport] listening on :${port}`),
    (err: unknown) => {
      console.error("[fake-transport] failed to start", err);
      process.exit(1);
    },
  );
}
