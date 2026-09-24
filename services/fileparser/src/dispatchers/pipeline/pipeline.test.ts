import { setImmediate as tick } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import { FakeObjectStore, FakeStagingStore, FakeStatusStore } from "../../test/fakes.js";
import { silentLogger } from "../../test/silentLogger.js";
import { deliverImport } from "../deliverImport.js";
import { stageImport } from "../stageImport.js";
import type { MappedCustomer } from "../utils/fieldMapping.js";
import { deliverStagedRows } from "./delivery.js";

const JOB = "00000000-0000-0000-0000-00000000025k";
const ROWS = 25_000;

function syntheticCsv(rows: number): Buffer {
  const lines = ["Name,Email,Phone,City,Plan"];
  for (let i = 0; i < rows; i++) {
    lines.push(`Customer ${i},c${i}@example.com,+39 333 ${String(i).padStart(7, "0")},City ${i % 50},plan-${i % 3}`);
  }
  return Buffer.from(lines.join("\n") + "\n");
}

async function stageSynthetic() {
  const objects = new FakeObjectStore({ "big.csv": syntheticCsv(ROWS) });
  const staging = new FakeStagingStore();
  const status = new FakeStatusStore();
  const report = vi.fn(async () => {});
  const outcome = await stageImport(
    { objects, staging, status, report, maxSpreadsheetBytes: 1024, log: silentLogger },
    { importJobId: JOB, businessId: 1, fileKey: "big.csv", isFinalAttempt: false },
  );
  return { staging, status, report, outcome };
}

/** A gateway double that answers asynchronously, like a real network call. */
function fakeGateway(failOnCall?: number) {
  const batches: MappedCustomer[][] = [];
  let calls = 0;
  const deliver = async (customers: MappedCustomer[]) => {
    calls++;
    await tick();
    if (calls === failOnCall) throw new Error("gateway INTERNAL");
    batches.push(customers);
  };
  return { deliver, batches, calls: () => calls };
}

function runDelivery(
  staging: FakeStagingStore,
  status: FakeStatusStore,
  deliver: (c: MappedCustomer[]) => Promise<void>,
  isFinalAttempt = false,
) {
  const report = vi.fn(async () => {});
  const promise = deliverImport(
    { staging, status, report, deliver, reschedule: async () => {}, log: silentLogger },
    {
      payload: { sessionId: JOB, businessId: 1, userId: 1, type: "customer", customfieldSettings: undefined },
      isFinalAttempt,
    },
  );
  return { promise, report };
}

describe("25k-row import pipeline", () => {
  it("stages and delivers every row in bounded batches without stalling", async () => {
    const { staging, status, outcome } = await stageSynthetic();
    expect(outcome).toEqual({ kind: "staged", rows: ROWS });
    expect(staging.rows).toHaveLength(ROWS);
    expect(staging.insertCalls).toBe(ROWS / 500);

    const gateway = fakeGateway();
    const { promise, report } = runDelivery(staging, status, gateway.deliver);

    await expect(promise).resolves.toEqual({ kind: "delivered", totalRows: ROWS, deliveredRows: ROWS });
    expect(gateway.batches).toHaveLength(ROWS / 500);
    expect(gateway.batches.every((b) => b.length === 500)).toBe(true);
    expect(gateway.batches[0]?.[0]).toEqual({
      name: "Customer 0",
      email: "c0@example.com",
      phone: "+39 333 0000000",
      customFields: { City: "City 0", Plan: "plan-0" },
    });
    expect(await staging.countUndelivered(JOB)).toBe(0);
    expect(status.rows.get(JOB)?.status).toBe("processed");
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "completed", totalRows: ROWS, processedRows: ROWS, failedRows: 0 }),
    );
  }, 30_000);

  it("resumes after a failed batch, re-sending only undelivered rows", async () => {
    const { staging, status } = await stageSynthetic();

    const first = fakeGateway(3);
    const attempt1 = runDelivery(staging, status, first.deliver);
    await expect(attempt1.promise).rejects.toThrow("gateway INTERNAL");
    expect(first.batches).toHaveLength(2);
    expect(await staging.countDelivered(JOB)).toBe(1_000);
    // Not the final attempt: status stays deliverable and no failure is reported.
    expect(status.rows.get(JOB)?.status).toBe("complete");
    expect(attempt1.report).not.toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));

    const second = fakeGateway();
    const attempt2 = runDelivery(staging, status, second.deliver);
    await expect(attempt2.promise).resolves.toMatchObject({ kind: "delivered", deliveredRows: ROWS });

    const firstEmails = first.batches.flat().map((c) => c.email);
    const secondEmails = second.batches.flat().map((c) => c.email);
    expect(secondEmails).toHaveLength(ROWS - 1_000);
    expect(secondEmails).not.toContain(firstEmails[0]);
    expect(new Set([...firstEmails, ...secondEmails]).size).toBe(ROWS);
  }, 30_000);

  it("marks the import failed with partial counts when the final attempt fails", async () => {
    const { staging, status } = await stageSynthetic();
    const gateway = fakeGateway(2);
    const { promise, report } = runDelivery(staging, status, gateway.deliver, true);

    await expect(promise).rejects.toThrow("gateway INTERNAL");
    expect(status.rows.get(JOB)).toMatchObject({ status: "fail", failReason: "gateway INTERNAL" });
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "failed", totalRows: ROWS, processedRows: 500, failedRows: ROWS - 500 }),
    );
  }, 30_000);
});

describe("deliverStagedRows", () => {
  it("walks keyset pages that do not line up with delivery batches", async () => {
    const staging = new FakeStagingStore();
    const records = Array.from({ length: 1_001 }, (_, i) => ({ n: `c${i}`, e: "", p: "" }));
    const { stageRows } = await import("./staging.js");
    await stageRows(records, { importJobId: JOB, businessId: 1, store: staging, batchSize: 100 });

    const readPage = vi.spyOn(staging, "readUndeliveredPage");
    const sizes: number[] = [];
    const result = await deliverStagedRows({
      importJobId: JOB,
      store: staging,
      settings: undefined,
      deliver: async (customers) => {
        sizes.push(customers.length);
      },
      batchSize: 250,
      pageSize: 333,
    });

    expect(result).toEqual({ delivered: 1_001, batches: 5 });
    expect(sizes).toEqual([250, 250, 250, 250, 1]);
    // Each page starts after the last id of the previous one.
    expect(readPage.mock.calls.map(([, afterId]) => afterId)).toEqual([0, 333, 666, 999, 1001]);
  });

  it("fails loudly on a staged row that is not a JSON object", async () => {
    const staging = new FakeStagingStore();
    vi.spyOn(staging, "readUndeliveredPage").mockResolvedValueOnce([{ id: 1, rawData: "[1,2]" }]);
    await expect(
      deliverStagedRows({
        importJobId: JOB,
        store: staging,
        settings: undefined,
        deliver: async () => {},
        batchSize: 10,
        pageSize: 10,
      }),
    ).rejects.toThrow("Staged row 1");
  });
});
