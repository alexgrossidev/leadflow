import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { toJobId, type EnqueueOptions, type senderDeliverToWhatsappPayload } from "@leadflow/shared";
import { MessageLogService } from "#modules/messageLogs/messageLog.service";
import type { MessageLogStore } from "#modules/messageLogs/messageLog.repo";
import type { NewWhatsappMessageLog, WhatsappMessageLog } from "#modules/messageLogs/messageLog.table";
import { createWhatsappRequestHandler } from "../whatsapp.receiver";

/** Queue double that applies the provider's real id rules: toJobId + dedupe on the id. */
class FakeQueue {
  readonly jobs = new Map<string, { name: string; data: unknown; opts: EnqueueOptions | undefined }>();
  readonly rawJobIds: string[] = [];

  async enqueue(name: string, data: unknown, opts?: EnqueueOptions): Promise<string> {
    if (opts?.jobId === undefined) throw new Error("expected a job id");
    this.rawJobIds.push(opts.jobId);
    const jobId = toJobId(opts.jobId);
    if (jobId.includes(":")) throw new Error("BullMQ rejects ':' in custom job ids");
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, { name, data, opts });
    return jobId;
  }
}

/** Minimal in-memory stand-in for the message-log table, unique on idempotency_key. */
class InMemoryMessageLogRepository implements MessageLogStore {
  readonly rows: WhatsappMessageLog[] = [];

  async findByIdempotencyKey(key: string): Promise<WhatsappMessageLog | null> {
    return this.rows.find((r) => r.idempotencyKey === key) ?? null;
  }

  async findById(id: number): Promise<WhatsappMessageLog | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async createPending(input: NewWhatsappMessageLog): Promise<WhatsappMessageLog> {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;
    const now = new Date();
    const row: WhatsappMessageLog = {
      id: this.rows.length + 1,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
      userId: input.userId,
      businessId: input.businessId,
      automationId: input.automationId ?? null,
      targetId: input.targetId ?? null,
      recipientId: input.recipientId ?? null,
      recipientType: input.recipientType ?? null,
      recipientPhone: input.recipientPhone,
      payloadRef: input.payloadRef ?? null,
      providerMessageId: null,
      attempts: 0,
      errorCode: null,
      errorMessage: null,
      errorPayload: null,
      createdAt: now,
      queuedAt: null,
      sentAt: null,
      failedAt: null,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }

  async markQueued(id: number): Promise<void> {
    this.patch(id, { queuedAt: new Date() });
  }

  async recordAttempt(id: number, attempts: number): Promise<void> {
    this.patch(id, { attempts });
  }

  async markSent(id: number, providerMessageId?: string): Promise<void> {
    this.patch(id, { status: "sent", providerMessageId: providerMessageId ?? null, sentAt: new Date() });
  }

  async markFailed(id: number, attempts: number): Promise<void> {
    this.patch(id, { status: "failed", attempts, failedAt: new Date() });
  }

  private patch(id: number, fields: Partial<WhatsappMessageLog>): void {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, fields);
  }
}

function setup() {
  const repo = new InMemoryMessageLogRepository();
  const queue = new FakeQueue();
  const messageLogs = new MessageLogService(repo);
  const handle = createWhatsappRequestHandler({ messageLogs, queue, attempts: 5, retryDelayMs: 1000 });
  return { repo, queue, handle };
}

const payloadFor = (idempotencyKey?: string): senderDeliverToWhatsappPayload => ({
  userId: 7,
  businessId: 3,
  automationId: 11,
  targetId: 42,
  recipientPhone: "+15550000001",
  content: { body: "Hi there" },
  ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
});

describe("whatsapp request intake", () => {
  it("enqueues under the producer's key and logs the original, un-normalised key", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.stringMatching(/^[a-z0-9+]{1,12}$/), { minLength: 2, maxLength: 6 }), async (parts) => {
        const key = parts.join(":");
        const { repo, queue, handle } = setup();

        await handle(payloadFor(key), { jobId: "event-1" });

        expect(queue.rawJobIds).toEqual([key]);
        expect([...queue.jobs.keys()]).toEqual([toJobId(key)]);
        expect(repo.rows[0]!.idempotencyKey).toBe(key);
        expect((queue.jobs.get(toJobId(key))!.data as { idempotencyKey: string }).idempotencyKey).toBe(key);
        expect(repo.rows[0]!.queuedAt).toBeInstanceOf(Date);
      }),
      { numRuns: 50 },
    );
  });

  it("derives a key when the producer sends none, and the same request maps to the same key", async () => {
    const { repo, queue, handle } = setup();

    await handle(payloadFor(), { jobId: "event-1" });
    await handle(payloadFor(), { jobId: "event-2" });

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]!.idempotencyKey).toMatch(/^whatsapp:11:42:\+15550000001:[0-9a-f]{16}$/);
    expect(queue.jobs.size).toBe(1);
  });

  it("a redelivered event for an already-sent message is not enqueued again", async () => {
    const { repo, queue, handle } = setup();
    await handle(payloadFor("whatsapp:11:42:+15550000001:abc"), { jobId: "event-1" });
    repo.rows[0]!.status = "sent";
    queue.jobs.clear();

    await handle(payloadFor("whatsapp:11:42:+15550000001:abc"), { jobId: "event-1-redelivery" });

    expect(queue.jobs.size).toBe(0);
  });
});
