import { describe, it, expect, vi } from "vitest";
import type { JobContext, WhatsappProcessPayload } from "@leadflow/shared";
import { RetriableWhatsappError, UnrecoverableWhatsappError } from "#transport/whatsapp.errors";
import { createWhatsappJobProcessor, type ProcessorDeps } from "../whatsapp.process";

const payload: WhatsappProcessPayload = {
  userId: 7,
  businessId: 3,
  recipientPhone: "+15550000001",
  content: { body: "Hi" },
  messageLogId: 1,
  idempotencyKey: "whatsapp:11:42:+15550000001:abc",
};

const job = (attemptsMade = 0): JobContext<WhatsappProcessPayload> => ({
  id: "whatsapp_11_42_+15550000001_abc",
  name: "whatsapp.process",
  data: payload,
  attemptsMade,
});

function setup(send: ProcessorDeps["client"]["send"], status: "pending" | "sent" | "failed" = "pending") {
  const deps = {
    messageLogs: {
      findById: vi.fn().mockResolvedValue({ id: 1, status }),
      markSent: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn().mockResolvedValue(undefined),
      recordAttempt: vi.fn().mockResolvedValue(undefined),
    },
    client: { send: vi.fn(send) },
    onSent: vi.fn().mockResolvedValue(undefined),
    maxAttempts: 3,
  } satisfies ProcessorDeps;
  return { deps, run: createWhatsappJobProcessor(deps) };
}

describe("whatsapp send processor", () => {
  it("stores the provider message id and records session activity on success", async () => {
    const { deps, run } = setup(async () => ({ providerMessageId: "true_15550000001@c.us_ABC" }));

    await run(job());

    expect(deps.messageLogs.markSent).toHaveBeenCalledWith(1, "true_15550000001@c.us_ABC");
    expect(deps.onSent).toHaveBeenCalledWith(3, 7);
  });

  it("a failure to record activity does not fail an already-sent message", async () => {
    const { deps, run } = setup(async () => ({}));
    deps.onSent.mockRejectedValue(new Error("redis down"));

    await expect(run(job())).resolves.toBeUndefined();
    expect(deps.messageLogs.markSent).toHaveBeenCalledWith(1, undefined);
  });

  it("skips messages that are already sent or failed", async () => {
    for (const status of ["sent", "failed"] as const) {
      const { deps, run } = setup(async () => ({}), status);
      await run(job());
      expect(deps.client.send).not.toHaveBeenCalled();
    }
  });

  it("rethrows a transient error while attempts remain, so BullMQ retries", async () => {
    const error = new RetriableWhatsappError("timeout", "TRANSPORT_TIMEOUT");
    const { deps, run } = setup(async () => Promise.reject(error));

    await expect(run(job(0))).rejects.toBe(error);
    expect(deps.messageLogs.recordAttempt).toHaveBeenCalledWith(1, 1, expect.objectContaining({ code: "TRANSPORT_TIMEOUT" }));
    expect(deps.messageLogs.markFailed).not.toHaveBeenCalled();
  });

  it("marks the message failed when retries are exhausted or the error is unrecoverable", async () => {
    const exhausted = setup(async () => Promise.reject(new RetriableWhatsappError("timeout", "TRANSPORT_TIMEOUT")));
    await exhausted.run(job(2));
    expect(exhausted.deps.messageLogs.markFailed).toHaveBeenCalledWith(1, 3, expect.objectContaining({ code: "TRANSPORT_TIMEOUT" }));

    const fatal = setup(async () => Promise.reject(new UnrecoverableWhatsappError("bad phone", "INVALID_PHONE")));
    await fatal.run(job(0));
    expect(fatal.deps.messageLogs.markFailed).toHaveBeenCalledWith(1, 1, expect.objectContaining({ code: "INVALID_PHONE" }));
  });

  it("an unexpected infrastructure error is retried, never marked failed", async () => {
    const { deps, run } = setup(async () => Promise.reject(new Error("ECONNRESET")));

    await expect(run(job(2))).rejects.toThrow("ECONNRESET");
    expect(deps.messageLogs.markFailed).not.toHaveBeenCalled();
  });
});
