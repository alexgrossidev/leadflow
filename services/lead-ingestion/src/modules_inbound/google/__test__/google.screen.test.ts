import { describe, it, expect, vi } from "vitest";
import { GoogleService, type GoogleServiceDeps } from "../google.service";
import type { SeenStore } from "../google.dedupe";
import type { GoogleLeadWebhookPayload } from "../google.schema";

const HONEYPOT = "website_confirm";
const WINDOW_MS = 900_000;
const NOW = 1_780_000_000_000;

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as GoogleServiceDeps["logger"];

/** In-memory SeenStore with the same semantics as the Redis one (TTL ignored). */
function memorySeenStore(): SeenStore & { seen: Set<string> } {
  const seen = new Set<string>();
  return {
    seen,
    isSeen: vi.fn(async (id: string) => seen.has(id)),
    markSeen: vi.fn(async (id: string) => {
      seen.add(id);
    }),
  };
}

function makeService(
  opts: {
    alreadySeen?: boolean | Error;
    rate?: boolean | Error;
    seenStore?: SeenStore;
  } = {},
) {
  const enqueue = vi.fn().mockResolvedValue("job-id");
  const { alreadySeen = false, rate = true } = opts;
  const isSeen =
    alreadySeen instanceof Error
      ? vi.fn().mockRejectedValue(alreadySeen)
      : vi.fn().mockResolvedValue(alreadySeen);
  const markSeen = vi.fn().mockResolvedValue(undefined);
  const allow =
    rate instanceof Error
      ? vi.fn().mockRejectedValue(rate)
      : vi.fn().mockResolvedValue(rate);
  const service = new GoogleService({
    secret: "s",
    queue: { enqueue },
    seenStore: opts.seenStore ?? { isSeen, markSeen },
    rateLimiter: { allow },
    honeypotField: HONEYPOT,
    replayWindowMs: WINDOW_MS,
    logger: noopLogger,
    now: () => NOW,
  });
  return { service, enqueue, isSeen, markSeen, allow };
}

function payload(
  over: Partial<GoogleLeadWebhookPayload> = {},
): GoogleLeadWebhookPayload {
  return {
    userId: 1001,
    businessId: 2001,
    responseId: "resp_1",
    createdTime: NOW,
    answers: [{ name: "Email", values: ["mario@example.com"] }],
    ...over,
  };
}

describe("GoogleService.captureLead: antispam edge gate", () => {
  it("enqueues a fresh, clean submission and then records it as seen", async () => {
    const { service, enqueue, markSeen } = makeService();
    await expect(service.captureLead(payload())).resolves.toEqual({
      status: "enqueued",
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(markSeen).toHaveBeenCalledWith("resp_1", WINDOW_MS);
    expect(enqueue.mock.invocationCallOrder[0]).toBeLessThan(
      markSeen.mock.invocationCallOrder[0],
    );
  });

  it("drops when the honeypot field is filled, without enqueueing", async () => {
    const { service, enqueue, isSeen } = makeService();
    const p = payload({
      answers: [
        { name: "Email", values: ["mario@example.com"] },
        { name: HONEYPOT, values: ["http://spam.example"] },
      ],
    });
    await expect(service.captureLead(p)).resolves.toEqual({
      status: "dropped",
      reason: "honeypot",
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(isSeen).not.toHaveBeenCalled(); // cheapest check short-circuits first
  });

  it("does not trip the honeypot on a blank value", async () => {
    const { service, enqueue } = makeService();
    const p = payload({
      answers: [
        { name: "Email", values: ["mario@example.com"] },
        { name: HONEYPOT, values: ["  "] },
      ],
    });
    await expect(service.captureLead(p)).resolves.toEqual({ status: "enqueued" });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("drops a submission older than the replay window", async () => {
    const { service, enqueue } = makeService();
    const p = payload({ createdTime: NOW - WINDOW_MS - 1_000 });
    await expect(service.captureLead(p)).resolves.toEqual({
      status: "dropped",
      reason: "stale",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("drops a submission timestamped beyond the allowed clock skew", async () => {
    const { service, enqueue } = makeService();
    const p = payload({ createdTime: NOW + 60 * 60 * 1000 });
    await expect(service.captureLead(p)).resolves.toEqual({
      status: "dropped",
      reason: "future_timestamp",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("tolerates a small forward clock skew", async () => {
    const { service } = makeService();
    const p = payload({ createdTime: NOW + 30_000 });
    await expect(service.captureLead(p)).resolves.toEqual({ status: "enqueued" });
  });

  it("drops an uncontactable submission on content heuristics, before any Redis call", async () => {
    const { service, enqueue, allow, isSeen } = makeService();
    const p = payload({ answers: [{ name: "Message", values: ["hello"] }] });
    await expect(service.captureLead(p)).resolves.toEqual({
      status: "dropped",
      reason: "content",
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(allow).not.toHaveBeenCalled();
    expect(isSeen).not.toHaveBeenCalled();
  });

  it("forwards soft antispam flags to the enqueued job", async () => {
    const { service, enqueue } = makeService();
    const p = payload({
      answers: [
        { name: "Email", values: ["x@mailinator.com"] },
        { name: "Phone", values: ["3331112223"] },
      ],
    });
    await expect(service.captureLead(p)).resolves.toEqual({ status: "enqueued" });
    const [, data] = enqueue.mock.calls[0];
    expect(data.flags).toContain("disposable_email");
  });

  it("drops a submission over the per-source rate limit", async () => {
    const { service, enqueue } = makeService({ rate: false });
    await expect(service.captureLead(payload())).resolves.toEqual({
      status: "dropped",
      reason: "rate_limited",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails open (enqueues) when the rate limiter errors", async () => {
    const { service, enqueue } = makeService({ rate: new Error("redis down") });
    await expect(service.captureLead(payload())).resolves.toEqual({
      status: "enqueued",
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("drops a duplicate responseId", async () => {
    const { service, enqueue } = makeService({ alreadySeen: true });
    await expect(service.captureLead(payload())).resolves.toEqual({
      status: "dropped",
      reason: "duplicate",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("fails open (enqueues) when the dedupe store errors", async () => {
    const { service, enqueue } = makeService({
      alreadySeen: new Error("redis down"),
    });
    await expect(service.captureLead(payload())).resolves.toEqual({
      status: "enqueued",
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  // Regression: the id used to be marked seen BEFORE the enqueue. A failed
  // enqueue answered 5xx, the relay retried, and the retry was then dropped as
  // a "duplicate": the lead was lost without any error.
  it("does not mark a submission seen when the enqueue fails, so the retry goes through", async () => {
    const seenStore = memorySeenStore();
    const { service, enqueue } = makeService({ seenStore });
    enqueue.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(service.captureLead(payload())).rejects.toThrow("redis unavailable");
    expect(seenStore.seen.has("resp_1")).toBe(false);

    await expect(service.captureLead(payload())).resolves.toEqual({
      status: "enqueued",
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(seenStore.seen.has("resp_1")).toBe(true);

    // ...and only now is a replay treated as a duplicate.
    await expect(service.captureLead(payload())).resolves.toEqual({
      status: "dropped",
      reason: "duplicate",
    });
  });

  it("still reports success when recording the id as seen fails after the enqueue", async () => {
    const { service, markSeen } = makeService();
    markSeen.mockRejectedValueOnce(new Error("redis blip"));
    await expect(service.captureLead(payload())).resolves.toEqual({
      status: "enqueued",
    });
  });
});
