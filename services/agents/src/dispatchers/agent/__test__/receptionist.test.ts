import { describe, expect, it } from "vitest";
import { AGENT_ERROR_CODES, AgentError } from "#core/agent/agent.errors";
import { AgentLoop } from "#core/agent/loop";
import { FakeLlmProvider, endTurn, toolTurn } from "#core/agent/providers/fake.provider";
import type { LeadflowClient } from "#core/axios/leadflow.client";
import type { AgentActionRecord } from "#modules/action/action.table";
import type { AgentConfigRecord } from "#modules/agent-config/agent-config.table";
import { DISPATCH_AGENT_ACTION } from "../../agent.js";
import { isAllowedAttachmentUrl } from "../tools.js";

/** Records every gateway call instead of making it. */
const recordingClient = () => {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const client: LeadflowClient = {
    post: async <T>(path: string, body: unknown) => {
      posts.push({ path, body: body as Record<string, unknown> });
      return {} as T;
    },
  };
  return { client, posts };
};

const action: AgentActionRecord = {
  id: "8c1f7a8e-6f2a-4c55-9f8e-0d3c2b1a0f11",
  businessId: "biz-1",
  userId: "user-1",
  type: "WHATSAPP_RECEIVED",
  status: "running",
  payload: {
    conversationId: "conv-1",
    conversation: [],
    inboundMessage: { content: "Quanto costa un taglio?" },
  },
  summary: null,
  errorCode: null,
  attempts: 0,
  inputTokens: 0,
  outputTokens: 0,
  createdAt: new Date(),
  startedAt: new Date(),
  finishedAt: null,
  updatedAt: new Date(),
};

const config = (overrides: Partial<AgentConfigRecord> = {}): AgentConfigRecord => ({
  businessId: "biz-1",
  userId: "user-1",
  instructions: "Be brief.",
  assistantName: null,
  assistantType: "receptionist",
  capabilities: ["whatsapp"],
  knowledgeBase: "A haircut costs 20 euro.",
  forbiddenKeywords: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const dispatch = async (
  provider: FakeLlmProvider,
  tenant: AgentConfigRecord = config(),
  attachmentUrlPrefixes: string[] = [],
) => {
  const { client, posts } = recordingClient();
  const loop = new AgentLoop(provider, { maxIterations: 4, maxTokens: 1_000 });
  const outcome = await DISPATCH_AGENT_ACTION(action, tenant, { loop, client, attachmentUrlPrefixes });
  return { outcome, posts };
};

const offeredTools = (provider: FakeLlmProvider) =>
  provider.calls[0]!.tools.map((tool) => tool.name);

describe("DISPATCH_AGENT_ACTION guardrails", () => {
  it("rejects a reply containing a forbidden keyword without calling the gateway, then sends the rewrite", async () => {
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "respond_whatsapp", input: { message: "Il prezzo è SCONTATO!" } }]),
      toolTurn([{ name: "respond_whatsapp", input: { message: "Il taglio costa 20 euro." } }]),
    ]);

    const { outcome, posts } = await dispatch(provider, config({ forbiddenKeywords: ["scont"] }));

    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.message).toBe("Il taglio costa 20 euro.");
    expect(JSON.stringify(provider.calls[1]!.transcript.at(-1))).toContain('contains \\"scont\\"');
    expect(outcome.actions).toEqual(["respond_whatsapp"]);
  });

  it("binds identity from the trigger, never from model arguments", async () => {
    const provider = new FakeLlmProvider([
      toolTurn([
        {
          name: "respond_whatsapp",
          input: { message: "Ciao", businessId: "other-biz", conversationId: "other-conv" },
        },
      ]),
      // Strict schema rejects the extra keys; the model retries cleanly.
      toolTurn([{ name: "respond_whatsapp", input: { message: "Ciao" } }]),
    ]);

    const { posts } = await dispatch(provider);

    expect(posts).toEqual([
      {
        path: "/internal/agents/whatsapp/send",
        body: { message: "Ciao", businessId: "biz-1", userId: "user-1", conversationId: "conv-1" },
      },
    ]);
  });

  it("ends the run after one reply: a second model turn is never requested", async () => {
    const provider = new FakeLlmProvider([
      toolTurn([
        { name: "respond_whatsapp", input: { message: "Uno" } },
        { name: "respond_whatsapp", input: { message: "Due" } },
      ]),
    ]);

    const { posts, outcome } = await dispatch(provider);

    expect(posts.map((post) => post.body.message)).toEqual(["Uno"]);
    expect(provider.calls).toHaveLength(1);
    expect(outcome.mutated).toBe(true);
  });

  it("answers an unknown tool with an error result", async () => {
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "refund_customer", input: { amount: 100 } }]),
      toolTurn([{ name: "respond_whatsapp", input: { message: "Ok" } }]),
    ]);

    const { posts } = await dispatch(provider);

    expect(posts).toHaveLength(1);
    expect(JSON.stringify(provider.calls[1]!.transcript.at(-1))).toContain("Unknown tool");
  });

  it("feeds invalid tool arguments back as a rejection", async () => {
    const provider = new FakeLlmProvider([
      toolTurn([{ name: "respond_whatsapp", input: { message: 42 } }]),
      toolTurn([{ name: "respond_whatsapp", input: { message: "Ok" } }]),
    ]);

    const { posts } = await dispatch(provider);

    expect(posts).toHaveLength(1);
    expect(JSON.stringify(provider.calls[1]!.transcript.at(-1))).toContain("Invalid arguments");
  });

  describe("capabilities", () => {
    it("offers only the tools the tenant enabled", async () => {
      const whatsappOnly = new FakeLlmProvider([endTurn()]);
      await dispatch(whatsappOnly, config({ capabilities: ["whatsapp"] }));
      expect(offeredTools(whatsappOnly)).toEqual(["respond_whatsapp"]);

      const everything = new FakeLlmProvider([endTurn()]);
      await dispatch(
        everything,
        config({ capabilities: ["whatsapp", "files", "calendar"] }),
        ["https://files.example.com/tenants/{businessId}/"],
      );
      expect(offeredTools(everything)).toEqual([
        "respond_whatsapp",
        "send_whatsapp_attachment",
        "schedule_appointment",
      ]);
    });

    it("hides the attachment tool when no storage prefix is configured", async () => {
      const provider = new FakeLlmProvider([endTurn()]);
      await dispatch(provider, config({ capabilities: ["whatsapp", "files"] }), []);
      expect(offeredTools(provider)).toEqual(["respond_whatsapp"]);
    });

    it("refuses to run a tenant that cannot reply at all", async () => {
      const provider = new FakeLlmProvider([endTurn()]);
      const error = await dispatch(provider, config({ capabilities: ["calendar"] })).catch(
        (e: unknown) => e as AgentError,
      );
      expect(error).toBeInstanceOf(AgentError);
      expect((error as AgentError).code).toBe(AGENT_ERROR_CODES.noCapabilities);
      expect(provider.calls).toHaveLength(0);
    });
  });

  it("puts customer text in the transcript and keeps the system prompt tenant-only", async () => {
    const provider = new FakeLlmProvider([endTurn()]);
    await dispatch(provider);
    const request = provider.calls[0]!;
    expect(request.system).not.toContain("Quanto costa");
    expect(request.system).toContain("A haircut costs 20 euro.");
    expect(request.transcript).toEqual([{ role: "user", text: "Quanto costa un taglio?" }]);
  });
});

describe("isAllowedAttachmentUrl", () => {
  const context = {
    businessId: "biz-1",
    attachmentUrlPrefixes: ["https://files.example.com/tenants/{businessId}/"],
  };

  it.each([
    ["https://files.example.com/tenants/biz-1/menu.pdf", true],
    ["https://files.example.com/tenants/biz-2/menu.pdf", false],
    ["https://files.example.com/tenants/biz-1/../biz-2/menu.pdf", false],
    ["https://files.example.com/tenants/biz-1/%2e%2e/biz-2/menu.pdf", false],
    ["http://files.example.com/tenants/biz-1/menu.pdf", false],
    ["https://files.example.com.attacker.example/tenants/biz-1/menu.pdf", false],
    ["https://user:pass@files.example.com/tenants/biz-1/menu.pdf", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
  ])("%s -> %s", (url, allowed) => {
    expect(isAllowedAttachmentUrl(url, context)).toBe(allowed);
  });

  it("rejects a disallowed file_url back to the model and sends nothing", async () => {
    const provider = new FakeLlmProvider([
      toolTurn([
        {
          name: "send_whatsapp_attachment",
          input: { file_url: "https://evil.example.net/x.pdf", file_type: "pdf" },
        },
      ]),
      toolTurn([{ name: "respond_whatsapp", input: { message: "Ecco" } }]),
    ]);

    const { posts } = await dispatch(
      provider,
      config({ capabilities: ["whatsapp", "files"] }),
      context.attachmentUrlPrefixes,
    );

    expect(posts.map((post) => post.path)).toEqual(["/internal/agents/whatsapp/send"]);
    expect(JSON.stringify(provider.calls[1]!.transcript.at(-1))).toContain("Not sent: file_url");
  });
});
