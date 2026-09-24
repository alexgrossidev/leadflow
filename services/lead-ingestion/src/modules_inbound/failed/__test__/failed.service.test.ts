import { describe, it, expect, vi } from "vitest";
import {
  MAX_RECOVERY_RETRIES,
  QueueRecoveryService,
  recoveryBackoffMs,
} from "../failed.service";
import type { QueueRecoveryStore } from "../failed.repo";
import type { QueueRecoveryRecord } from "../failed.table";
import { JobNames } from "@leadflow/shared/jobs";

const NOW = new Date("2026-07-02T10:00:00.000Z");
const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

function record(over: Partial<QueueRecoveryRecord> = {}): QueueRecoveryRecord {
  return {
    id: 7,
    queueName: JobNames.FACEBOOK_LEAD_PROCESS,
    dedupeKey: "lg_1",
    payload: { leadgenId: "lg_1", pageId: "page_1" },
    errorCode: "LeadRetryableError",
    errorType: "TRANSIENT",
    status: "PENDING_RECOVERY",
    retryCount: 2,
    nextRetryAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function fakeStore(over: Partial<QueueRecoveryStore> = {}) {
  const upsert = vi.fn().mockResolvedValue(undefined);
  return {
    upsert,
    findByKey: vi.fn().mockResolvedValue(null),
    findDue: vi.fn().mockResolvedValue([]),
    claimForRecovery: vi.fn().mockResolvedValue(true),
    reschedule: vi.fn().mockResolvedValue(true),
    finalize: vi.fn().mockResolvedValue(true),
    ...over,
    upsertMock: upsert,
  };
}

describe("recoveryBackoffMs", () => {
  it("doubles from one minute", () => {
    expect(recoveryBackoffMs(0)).toBe(60_000);
    expect(recoveryBackoffMs(1)).toBe(120_000);
    expect(recoveryBackoffMs(3)).toBe(480_000);
  });

  it("is capped at one hour", () => {
    expect(recoveryBackoffMs(6)).toBe(60 * 60 * 1000);
    expect(recoveryBackoffMs(50)).toBe(60 * 60 * 1000);
  });
});

describe("QueueRecoveryService.capture", () => {
  it("opens a pending row keyed on the lead id", async () => {
    const repo = fakeStore();
    const service = new QueueRecoveryService(repo, { enqueue: vi.fn() }, silent);

    await service.capture(
      {
        queueName: JobNames.FACEBOOK_LEAD_PROCESS,
        payload: { leadgenId: "lg_1", pageId: "page_1" },
        errorType: "TRANSIENT",
      },
      NOW,
    );

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupeKey: "lg_1",
        status: "PENDING_RECOVERY",
        retryCount: 0,
        nextRetryAt: new Date(NOW.getTime() + 60_000),
      }),
    );
  });

  it("re-opens an existing row with a higher retry count, so backoff keeps growing", async () => {
    const repo = fakeStore({ findByKey: vi.fn().mockResolvedValue(record({ retryCount: 2 })) });
    const service = new QueueRecoveryService(repo, { enqueue: vi.fn() }, silent);

    await service.capture(
      { queueName: JobNames.FACEBOOK_LEAD_PROCESS, payload: record().payload, errorType: "TRANSIENT" },
      NOW,
    );

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ retryCount: 3, nextRetryAt: new Date(NOW.getTime() + 480_000) }),
    );
  });

  it("parks FATAL failures and anything past the retry cap", async () => {
    const repo = fakeStore({
      findByKey: vi.fn().mockResolvedValue(record({ retryCount: MAX_RECOVERY_RETRIES - 1 })),
    });
    const service = new QueueRecoveryService(repo, { enqueue: vi.fn() }, silent);

    await service.capture(
      { queueName: JobNames.GOOGLE_LEAD_PROCESS, payload: { responseId: "r1" }, errorType: "FATAL" },
      NOW,
    );
    await service.capture(
      { queueName: JobNames.FACEBOOK_LEAD_PROCESS, payload: record().payload, errorType: "TRANSIENT" },
      NOW,
    );

    expect(repo.upsertMock.mock.calls[0][0]).toMatchObject({ dedupeKey: "r1", status: "FAILED_PERMANENTLY" });
    expect(repo.upsertMock.mock.calls[1][0]).toMatchObject({ status: "FAILED_PERMANENTLY", nextRetryAt: null });
  });
});

describe("QueueRecoveryService.runSweep", () => {
  it("re-enqueues outside any transaction with a retry-scoped job id and the lead retry policy", async () => {
    const enqueue = vi.fn().mockResolvedValue("id");
    const repo = fakeStore({ findDue: vi.fn().mockResolvedValue([record()]) });
    const service = new QueueRecoveryService(repo, { enqueue }, silent);

    const result = await service.runSweep({ now: NOW });

    expect(enqueue).toHaveBeenCalledWith(
      JobNames.FACEBOOK_LEAD_PROCESS,
      { leadgenId: "lg_1", pageId: "page_1" },
      expect.objectContaining({ jobId: "lead_lg_1_recovery_2", attempts: 5 }),
    );
    expect(repo.finalize).toHaveBeenCalledWith(7, "RESOLVED");
    expect(result).toMatchObject({ claimed: 1, requeued: 1, skipped: 0 });
  });

  it("skips a record another sweeper claimed", async () => {
    const enqueue = vi.fn();
    const repo = fakeStore({
      findDue: vi.fn().mockResolvedValue([record()]),
      claimForRecovery: vi.fn().mockResolvedValue(false),
    });
    const result = await new QueueRecoveryService(repo, { enqueue }, silent).runSweep({ now: NOW });

    expect(enqueue).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });

  it("reschedules with capped backoff when the enqueue fails", async () => {
    const enqueue = vi.fn().mockRejectedValue(new Error("redis down"));
    const repo = fakeStore({ findDue: vi.fn().mockResolvedValue([record({ retryCount: 9 })]) });
    await new QueueRecoveryService(repo, { enqueue }, silent).runSweep({ now: NOW });

    expect(repo.finalize).not.toHaveBeenCalled();
    expect(repo.reschedule).toHaveBeenCalledWith(7, new Date(NOW.getTime() + 60 * 60 * 1000));
  });

  it("counts the lead as requeued even if finalize fails after the enqueue", async () => {
    const repo = fakeStore({
      findDue: vi.fn().mockResolvedValue([record()]),
      finalize: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const result = await new QueueRecoveryService(repo, { enqueue: vi.fn() }, silent).runSweep({ now: NOW });
    expect(result.requeued).toBe(1);
  });
});
