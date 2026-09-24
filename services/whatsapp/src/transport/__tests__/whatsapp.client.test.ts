import { afterEach, describe, it, expect, vi } from "vitest";
import type { WhatsappProcessPayload } from "@leadflow/shared";
import { extractProviderMessageId, WhatsappClient } from "../whatsapp.client";
import { RetriableWhatsappError, UnrecoverableWhatsappError } from "../whatsapp.errors";

const SECRET = "transport-secret-0123456789abcdef";

const payload: WhatsappProcessPayload = {
  userId: 7,
  businessId: 3,
  recipientPhone: "15550000001",
  content: { body: "Hi" },
  messageLogId: 1,
  idempotencyKey: "k",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Stubs fetch: generate-token succeeds, send-message answers with `sendResponse()`. */
function stubTransport(sendResponse: () => Response) {
  const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/generate-token")) return json(201, { status: "success", token: "tok" });
    if (url.endsWith("/send-message")) return sendResponse();
    return json(404, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractProviderMessageId", () => {
  it.each([
    ["upstream array response", { status: "success", response: [{ id: "true_1@c.us_AAA" }] }, "true_1@c.us_AAA"],
    ["single-object response", { response: { id: "true_1@c.us_BBB" } }, "true_1@c.us_BBB"],
    ["serialized id object", { response: [{ id: { _serialized: "true_1@c.us_CCC" } }] }, "true_1@c.us_CCC"],
    ["empty array", { response: [] }, undefined],
    ["missing response", { status: "success" }, undefined],
    ["non-string id", { response: [{ id: 42 }] }, undefined],
    ["null body", null, undefined],
  ])("%s", (_label, body, expected) => {
    expect(extractProviderMessageId(body)).toBe(expected);
  });
});

describe("WhatsappClient.send", () => {
  const client = () => new WhatsappClient({ baseUrl: "http://transport.test", secretKey: SECRET, timeoutMs: 1_000 });

  it("returns the id from the upstream array-shaped response", async () => {
    stubTransport(() => json(201, { status: "success", response: [{ id: "true_15550000001@c.us_XYZ" }], session: "3_7" }));

    await expect(client().send(payload)).resolves.toEqual({ providerMessageId: "true_15550000001@c.us_XYZ" });
  });

  it("sends the bearer token and never the secret to send-message", async () => {
    const fetchMock = stubTransport(() => json(201, { status: "success", response: [] }));

    await client().send(payload);

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe("http://transport.test/api/3_7/send-message");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("treats a Disconnected session as retriable", async () => {
    stubTransport(() => json(404, { response: null, status: "Disconnected", message: "Session is not active" }));

    await expect(client().send(payload)).rejects.toMatchObject({ code: "SESSION_DISCONNECTED" });
    await expect(client().send(payload)).rejects.toBeInstanceOf(RetriableWhatsappError);
  });

  it("treats other 4xx responses as unrecoverable", async () => {
    stubTransport(() => json(400, { status: "Error", message: "invalid phone" }));

    await expect(client().send(payload)).rejects.toBeInstanceOf(UnrecoverableWhatsappError);
  });

  it("network errors carry the endpoint name, never the secret-bearing URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    const error = await client().send(payload).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RetriableWhatsappError);
    expect(JSON.stringify({ ...(error as object), message: (error as Error).message })).not.toContain(SECRET);
    expect((error as RetriableWhatsappError).payload).toEqual({ endpoint: "generate-token" });
  });
});
