import crypto from "crypto";
import { describe, it, expect, vi } from "vitest";
import { buildApp } from "../../../app";
import { FacebookController } from "../facebook.controller";
import { FacebookService } from "../facebook.service";
import { FacebookTokenService } from "../../fbToken/fbToken.service";
import { createOAuthState } from "../oauth.state";
import type { NonceStore } from "../oauth.nonce";
import { JobNames } from "@leadflow/shared/jobs";

const APP_SECRET = "fb-app-secret";
const VERIFY_TOKEN = "verify-me";
const STATE_SECRET = "state-secret-state-secret-state-secret";
const SERVICE_TOKEN = "service-token-0123456789";

const sign = (body: string, secret = APP_SECRET) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

function memoryNonces(): NonceStore {
  const used = new Set<string>();
  return {
    async consume(nonce) {
      if (used.has(nonce)) return false;
      used.add(nonce);
      return true;
    },
  };
}

async function buildTestApp() {
  const enqueue = vi.fn().mockResolvedValue("job-id");
  const service = new FacebookService({
    queue: { enqueue },
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
  });
  const tokenService = new FacebookTokenService({ enqueue });
  const controller = new FacebookController(service, tokenService, memoryNonces(), {
    appId: "app_123",
    apiVersion: "v22.0",
    redirectUri: "https://ingest.example.test/fb/auth",
    scopes: "leads_retrieval",
    stateSecret: STATE_SECRET,
    serviceToken: SERVICE_TOKEN,
  });
  const app = await buildApp({ facebookController: controller });
  return { app, enqueue };
}

const leadgenChange = (leadgenId: string) => ({
  field: "leadgen",
  value: { leadgen_id: leadgenId, page_id: "page_1", form_id: "form_1" },
});

const webhook = (changes: unknown[]) =>
  JSON.stringify({
    object: "page",
    entry: [{ id: "page_1", time: 1_780_000_000, changes }],
  });

describe("POST /fb/capture (leadgen webhook)", () => {
  const post = async (payload: string, signature?: string) => {
    const { app, enqueue } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/fb/capture",
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-hub-signature-256": signature } : {}),
      },
      payload,
    });
    return { res, enqueue };
  };

  it("rejects a missing signature with 403 and enqueues nothing", async () => {
    const { res, enqueue } = await post(webhook([leadgenChange("lg_1")]));
    expect(res.statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a signature made with another secret with 403", async () => {
    const body = webhook([leadgenChange("lg_1")]);
    const { res, enqueue } = await post(body, sign(body, "not-the-secret"));
    expect(res.statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a tampered body with 403", async () => {
    const body = webhook([leadgenChange("lg_1")]);
    const { res, enqueue } = await post(
      body.replace("lg_1", "lg_9"),
      sign(body),
    );
    expect(res.statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues one idempotent job per leadgen change and skips other fields", async () => {
    const body = webhook([
      leadgenChange("lg_1"),
      { field: "feed", value: { item: "status" } },
      leadgenChange("lg_2"),
    ]);
    const { res, enqueue } = await post(body, sign(body));

    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(2);
    const [name, data, opts] = enqueue.mock.calls[0];
    expect(name).toBe(JobNames.FACEBOOK_LEAD_PROCESS);
    expect(data).toEqual({
      leadgenId: "lg_1",
      pageId: "page_1",
      formId: "form_1",
      createdTime: undefined,
    });
    expect(opts).toMatchObject({ jobId: "lead_lg_1", attempts: 5 });
    expect(enqueue.mock.calls[1][2].jobId).toBe("lead_lg_2");
  });

  it("accepts organic/test leads without ad_id, adgroup_id or created_time", async () => {
    const body = webhook([
      { field: "leadgen", value: { leadgen_id: "lg_3", page_id: "page_1" } },
    ]);
    const { res, enqueue } = await post(body, sign(body));
    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("answers 400 for a signed body that is not a webhook envelope", async () => {
    const body = JSON.stringify({ hello: "world" });
    const { res, enqueue } = await post(body, sign(body));
    expect(res.statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("GET /fb/capture (subscription handshake)", () => {
  it("echoes the challenge when the verify token matches", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: `/fb/capture?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("12345");
  });

  it("answers 403 when the verify token does not match", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/fb/capture?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("12345");
  });
});

describe("Facebook connect flow", () => {
  it("GET /fb/connect requires the service token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/fb/connect?businessId=2001&userId=1001",
      headers: { "x-service-token": "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /fb/connect redirects to the dialog with a signed state for the account", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/fb/connect?businessId=2001&userId=1001",
      headers: { "x-service-token": SERVICE_TOKEN },
    });

    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin + location.pathname).toBe(
      "https://www.facebook.com/v22.0/dialog/oauth",
    );
    expect(location.searchParams.get("client_id")).toBe("app_123");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://ingest.example.test/fb/auth",
    );
    expect(location.searchParams.get("state")).toMatch(/^[\w-]+\.[\w-]+$/);
  });

  it("the OAuth callback enqueues the exchange for the account in the signed state", async () => {
    const { app, enqueue } = await buildTestApp();
    const state = createOAuthState({ businessId: 2001, userId: 1001 }, STATE_SECRET);

    const res = await app.inject({
      method: "GET",
      url: `/fb/auth?code=oauth-code&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [name, data] = enqueue.mock.calls[0];
    expect(name).toBe(JobNames.FACEBOOK_EXCHANGE_TOKEN);
    expect(data).toMatchObject({ userId: 1001, businessId: 2001, accessToken: "oauth-code" });
  });

  it("rejects an unsigned business_id_X_user_id_Y state", async () => {
    const { app, enqueue } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/fb/auth?code=oauth-code&state=business_id_2001_user_id_1001",
    });
    expect(res.statusCode).toBe(403);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a replayed callback URL (single-use nonce)", async () => {
    const { app, enqueue } = await buildTestApp();
    const state = encodeURIComponent(
      createOAuthState({ businessId: 2001, userId: 1001 }, STATE_SECRET),
    );

    const first = await app.inject({ method: "GET", url: `/fb/auth?code=c1&state=${state}` });
    const replay = await app.inject({ method: "GET", url: `/fb/auth?code=c2&state=${state}` });

    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(403);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("answers 400 without enqueueing when the user declined the dialog", async () => {
    const { app, enqueue } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/fb/capture?error=access_denied&error_reason=user_denied",
    });
    expect(res.statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
