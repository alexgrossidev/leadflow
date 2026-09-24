import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { AGENT_ERROR_CODES, AgentError } from "#core/agent/agent.errors";
import type { AssistantTurn, ChatRequest } from "#core/agent/llm.port";
import { AgentLoop } from "#core/agent/loop";
import { FakeLlmProvider, endTurn, toolTurn, type FakeStep } from "#core/agent/providers/fake.provider";
import type { LeadflowClient } from "#core/axios/leadflow.client";
import { WorkQueue } from "#core/queue/work-queue";
import { DISPATCH_AGENT_ACTION } from "#dispatchers/agent";
import type { OnboardingResult } from "#dispatchers/onboarding/types";
import { ActionExecutor } from "../action/action.executor.js";
import { ActionService } from "../action/action.service.js";
import type { AgentCapability } from "../agent-config/agent-config.registry.js";
import { AgentConfigService } from "../agent-config/agent-config.service.js";
import { HealthService } from "../health/health.service.js";
import { OnboardingService, type RunOnboarding } from "../onboarding/onboarding.service.js";
import {
  InMemoryActionStore,
  InMemoryAgentConfigStore,
  InMemoryIdempotencyStore,
} from "./in-memory-stores.js";

const TOKEN = "test-service-token";

const reply = (message: string): AssistantTurn =>
  toolTurn([{ name: "respond_whatsapp", input: { message } }], { inputTokens: 120, outputTokens: 30 });

/** Wires the real services, queue and executor around in-memory stores and a scripted LLM. */
const buildHarness = (script: FakeStep[] | FakeStep) => {
  const actions = new InMemoryActionStore();
  const configs = new InMemoryAgentConfigStore();
  const idempotency = new InMemoryIdempotencyStore();
  const posts: Array<{ path: string; body: unknown }> = [];
  const client: LeadflowClient = {
    post: async <T>(path: string, body: unknown) => {
      posts.push({ path, body });
      return {} as T;
    },
  };
  const provider = new FakeLlmProvider(script);
  const loop = new AgentLoop(provider, { maxIterations: 4, maxTokens: 1_000 });
  const executor = new ActionExecutor(
    actions,
    configs,
    (action, config, signal) =>
      DISPATCH_AGENT_ACTION(action, config, { loop, client, attachmentUrlPrefixes: [] }, signal),
    {
      runTimeoutMs: 5_000,
      retry: { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => undefined },
    },
  );
  const queue = new WorkQueue<string>((id) => executor.execute(id), { concurrency: 2, limit: 10 });
  const runOnboarding = vi.fn<RunOnboarding>(
    async (): Promise<OnboardingResult> => ({
      businessId: "b-new",
      results: [{ key: "business_info", status: "created" }],
      unresolved: [],
      usage: { inputTokens: 10, outputTokens: 2 },
    }),
  );

  const app = createApp({
    serviceToken: TOKEN,
    exposeInternalErrors: false,
    actions: new ActionService(actions, queue),
    agentConfigs: new AgentConfigService(configs),
    onboarding: new OnboardingService(idempotency, runOnboarding),
    health: new HealthService(async () => true),
  });
  return { app, actions, configs, queue, provider, posts, runOnboarding, executor };
};

const trigger = {
  businessId: "biz-1",
  userId: "user-1",
  type: "WHATSAPP_RECEIVED",
  payload: {
    conversationId: "conv-1",
    inboundMessage: { content: "Siete aperti domani?" },
  },
};

const tenantConfig = {
  businessId: "biz-1",
  userId: "user-1",
  instructions: "Answer opening-hour questions.",
  capabilities: ["whatsapp"] as AgentCapability[],
};

describe("service auth", () => {
  const { app } = buildHarness([]);

  it.each(["/actions", "/agents/biz-1/user-1/config", "/onboarding"])(
    "rejects %s without a service token",
    async (path) => {
      const response = await request(app).post(path).send({});
      expect(response.status).toBe(401);
    },
  );

  it("rejects a wrong token", async () => {
    const response = await request(app)
      .get("/actions/8c1f7a8e-6f2a-4c55-9f8e-0d3c2b1a0f11")
      .set("x-service-token", "nope");
    expect(response.status).toBe(401);
    expect(response.body.code).toBe("UNAUTHORIZED");
  });

  it("serves /health without a token", async () => {
    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body.data.database).toBe("up");
  });
});

describe("POST /actions", () => {
  it("accepts with 202, runs in the background, and reports the outcome without the customer payload", async () => {
    // Hold the model call open so the intermediate status is observable.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const harness = buildHarness(async (_request: ChatRequest) => {
      await gate;
      return reply("Sì, dalle 9 alle 18.");
    });
    await harness.configs.upsert(tenantConfig);

    const accepted = await request(harness.app)
      .post("/actions")
      .set("x-service-token", TOKEN)
      .send(trigger);
    expect(accepted.status).toBe(202);
    expect(accepted.body.data).toEqual({ id: expect.any(String), status: "pending" });
    const id: string = accepted.body.data.id;
    expect(accepted.headers.location).toBe(`/actions/${id}`);

    await vi.waitFor(async () => {
      const running = await request(harness.app).get(`/actions/${id}`).set("x-service-token", TOKEN);
      expect(running.body.data.status).toBe("running");
    });

    release();
    await harness.queue.drain();

    const done = await request(harness.app).get(`/actions/${id}`).set("x-service-token", TOKEN);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      status: "succeeded",
      summary: "actions: respond_whatsapp",
      attempts: 1,
      inputTokens: 120,
      outputTokens: 30,
      errorCode: null,
    });
    expect(done.body.data).not.toHaveProperty("payload");
    // Purged on terminal status.
    expect(harness.actions.rows.get(id)!.payload).toBeNull();
    expect(harness.posts).toEqual([
      {
        path: "/internal/agents/whatsapp/send",
        body: {
          message: "Sì, dalle 9 alle 18.",
          businessId: "biz-1",
          userId: "user-1",
          conversationId: "conv-1",
        },
      },
    ]);
  });

  it("retries a transient provider failure and records the attempts", async () => {
    const harness = buildHarness([
      new AgentError("503", AGENT_ERROR_CODES.providerFailed, { retryable: true }),
      reply("Ok"),
    ]);
    await harness.configs.upsert(tenantConfig);

    const accepted = await request(harness.app).post("/actions").set("x-service-token", TOKEN).send(trigger);
    await harness.queue.drain();

    const row = harness.actions.rows.get(accepted.body.data.id)!;
    expect(row).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(harness.posts).toHaveLength(1);
  });

  it("marks the run failed with a code when the tenant has no config", async () => {
    const harness = buildHarness([reply("never")]);

    const accepted = await request(harness.app).post("/actions").set("x-service-token", TOKEN).send(trigger);
    await harness.queue.drain();

    const done = await request(harness.app)
      .get(`/actions/${accepted.body.data.id}`)
      .set("x-service-token", TOKEN);
    expect(done.body.data).toMatchObject({ status: "failed", errorCode: AGENT_ERROR_CODES.configMissing });
    expect(harness.provider.calls).toHaveLength(0);
  });

  it("validates the trigger", async () => {
    const { app } = buildHarness([]);
    const response = await request(app)
      .post("/actions")
      .set("x-service-token", TOKEN)
      .send({ ...trigger, type: "EMAIL_RECEIVED" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers malformed JSON with 400, not 500", async () => {
    const { app } = buildHarness([]);
    const response = await request(app)
      .post("/actions")
      .set("x-service-token", TOKEN)
      .set("content-type", "application/json")
      .send("{not json");
    expect(response.status).toBe(400);
  });
});

describe("ActionExecutor.recover", () => {
  it("fails runs interrupted mid-flight and re-queues ones that never started", async () => {
    const harness = buildHarness([reply("Ok")]);
    await harness.configs.upsert(tenantConfig);
    const row = (id: string, status: "running" | "pending") =>
      harness.actions.insert({
        id,
        businessId: "biz-1",
        userId: "user-1",
        type: "WHATSAPP_RECEIVED",
        status,
        payload: { conversationId: "c", conversation: [], inboundMessage: { content: "x" } },
      });
    const running = await row("r1", "running");
    const pending = await row("p1", "pending");

    await harness.executor.recover((id) => harness.queue.enqueue(id));
    await harness.queue.drain();

    expect(harness.actions.rows.get(running.id)).toMatchObject({
      status: "failed",
      errorCode: AGENT_ERROR_CODES.interrupted,
      payload: null,
    });
    expect(harness.actions.rows.get(pending.id)).toMatchObject({ status: "succeeded" });
  });
});

describe("PUT /agents/:businessId/:userId/config", () => {
  it("caps the knowledge base with a clear 400", async () => {
    const { app } = buildHarness([]);
    const response = await request(app)
      .put("/agents/biz-1/user-1/config")
      .set("x-service-token", TOKEN)
      .send({ instructions: "x", capabilities: ["whatsapp"], knowledgeBase: "a".repeat(50_001) });
    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([
      expect.objectContaining({
        field: "knowledgeBase",
        message: "knowledgeBase must be at most 50,000 characters",
      }),
    ]);
  });
});

describe("POST /onboarding idempotency", () => {
  let harness: ReturnType<typeof buildHarness>;
  const body = { userId: "user-1", locale: "it", inputs: { business_info: "Barberia Esempio" } };
  const post = (key: string | undefined, payload: object = body) => {
    const call = request(harness.app).post("/onboarding").set("x-service-token", TOKEN);
    return (key ? call.set("Idempotency-Key", key) : call).send(payload);
  };

  beforeEach(() => {
    harness = buildHarness([endTurn()]);
  });

  it("runs once and replays the stored result for a retry with the same key", async () => {
    const first = await post("key-1");
    const retry = await post("key-1");

    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    expect(retry.body.data).toEqual(first.body.data);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(harness.runOnboarding).toHaveBeenCalledTimes(1);
  });

  it("refuses a key reused with a different body", async () => {
    await post("key-1");
    const reused = await post("key-1", { ...body, inputs: { business_info: "Altro" } });

    expect(reused.status).toBe(409);
    expect(reused.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(harness.runOnboarding).toHaveBeenCalledTimes(1);
  });

  it("requires the header", async () => {
    const response = await post(undefined);
    expect(response.status).toBe(400);
    expect(harness.runOnboarding).not.toHaveBeenCalled();
  });

  it("scopes keys per user", async () => {
    await post("key-1");
    await post("key-1", { ...body, userId: "user-2" });
    expect(harness.runOnboarding).toHaveBeenCalledTimes(2);
  });
});
