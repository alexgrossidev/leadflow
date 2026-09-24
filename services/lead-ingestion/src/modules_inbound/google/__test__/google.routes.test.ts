import crypto from "crypto";
import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../../../app";
import { GoogleService } from "../google.service";
import { GoogleController } from "../google.controller";
import { GOOGLE_SIGNATURE_HEADER } from "../google.signature";

const SECRET = "route-secret";
const sign = (body: string) =>
  "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");

/** The production app, with the Google service's collaborators replaced by fakes. */
async function buildTestApp(opts: { alreadySeen?: boolean } = {}) {
  const enqueue = vi.fn().mockResolvedValue("job-id");
  const service = new GoogleService({
    secret: SECRET,
    queue: { enqueue },
    seenStore: {
      isSeen: vi.fn().mockResolvedValue(opts.alreadySeen ?? false),
      markSeen: vi.fn().mockResolvedValue(undefined),
    },
    // Permissive limiter so the edge doesn't reach for real Redis in tests.
    rateLimiter: { allow: vi.fn().mockResolvedValue(true) },
  });
  const app = await buildApp({ googleController: new GoogleController(service) });
  return { app, enqueue };
}

const body = () =>
  JSON.stringify({
    userId: 1001,
    businessId: 2001,
    responseId: "resp_it_1",
    createdTime: Date.now(),
    answers: [{ name: "Email", values: ["mario@example.com"] }],
  });

const post = (
  app: Awaited<ReturnType<typeof buildTestApp>>["app"],
  payload: string,
  signature: string,
) =>
  app.inject({
    method: "POST",
    url: "/google/capture",
    headers: {
      "content-type": "application/json",
      [GOOGLE_SIGNATURE_HEADER]: signature,
    },
    payload,
  });

describe("POST /google/capture", () => {
  it("accepts a validly-signed submission with 200 and enqueues it", async () => {
    const { app, enqueue } = await buildTestApp();
    const payload = body();

    const res = await post(app, payload, sign(payload));

    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects a bad signature with 403 and does not enqueue", async () => {
    const { app, enqueue } = await buildTestApp();

    const res = await post(app, body(), "sha256=deadbeef");

    expect(res.statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("still ACKs 200 for a duplicate submission but does not enqueue", async () => {
    const { app, enqueue } = await buildTestApp({ alreadySeen: true });
    const payload = body();

    const res = await post(app, payload, sign(payload));

    expect(res.statusCode).toBe(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("answers 400 with the failing fields for a signed but invalid body", async () => {
    const { app, enqueue } = await buildTestApp();
    const payload = JSON.stringify({ userId: 1001, answers: [] });

    const res = await post(app, payload, sign(payload));

    expect(res.statusCode).toBe(400);
    expect(res.json().issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(["businessId", "responseId", "createdTime"]),
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("answers 500 without internals when enqueueing fails", async () => {
    const { app, enqueue } = await buildTestApp();
    enqueue.mockRejectedValueOnce(new Error("redis://secret-host:6379 refused"));
    const payload = body();

    const res = await post(app, payload, sign(payload));

    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret-host");
  });
});
