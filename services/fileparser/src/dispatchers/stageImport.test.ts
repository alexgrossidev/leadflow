import { describe, expect, it, vi } from "vitest";
import { utils, write } from "xlsx";
import { FakeObjectStore, FakeStagingStore, FakeStatusStore } from "../test/fakes.js";
import { silentLogger } from "../test/silentLogger.js";
import { stageImport } from "./stageImport.js";

const JOB = "00000000-0000-0000-0000-000000000001";

function setup(files: Record<string, Buffer>, sizes: Record<string, number> = {}) {
  const objects = new FakeObjectStore(files, sizes);
  const staging = new FakeStagingStore();
  const status = new FakeStatusStore();
  const report = vi.fn(async () => {});
  const deps = { objects, staging, status, report, maxSpreadsheetBytes: 1024 * 1024, log: silentLogger, batchSize: 2 };
  const run = (fileKey: string, isFinalAttempt = false) =>
    stageImport(deps, { importJobId: JOB, businessId: 7, fileKey, isFinalAttempt });
  return { objects, staging, status, report, run };
}

describe("stageImport", () => {
  it("stages a CSV file and deduplicates identical rows", async () => {
    const csv = Buffer.from("Name,Email\nAda,a@example.com\nGrace,g@example.com\nAda,a@example.com\n");
    const { staging, status, run } = setup({ "f.csv": csv });

    await expect(run("f.csv")).resolves.toEqual({ kind: "staged", rows: 3 });
    expect(staging.rows.map((r) => r.rawData)).toEqual([
      { Name: "Ada", Email: "a@example.com" },
      { Name: "Grace", Email: "g@example.com" },
    ]);
    expect(staging.insertCalls).toBe(2);
    expect(status.rows.get(JOB)?.status).toBe("complete");
  });

  it("stages an XLSX file through the same path", async () => {
    const book = utils.book_new();
    utils.book_append_sheet(book, utils.aoa_to_sheet([["Name", "Email"], ["Ada", "a@example.com"]]), "S");
    const { staging, run } = setup({ "f.xlsx": write(book, { type: "buffer", bookType: "xlsx" }) as Buffer });

    await expect(run("f.xlsx")).resolves.toEqual({ kind: "staged", rows: 1 });
    expect(staging.rows[0]?.rawData).toEqual({ Name: "Ada", Email: "a@example.com" });
  });

  it("is idempotent when a retry stages the same file again", async () => {
    const csv = Buffer.from("Name\nAda\nGrace\n");
    const { staging, run } = setup({ "f.csv": csv });
    await run("f.csv");
    await staging.markDelivered(JOB, [1]);
    await run("f.csv");
    expect(staging.rows.map((r) => r.status)).toEqual(["DELIVERED", "RAW"]);
  });

  it("fails an unsupported file type explicitly, without retrying or downloading", async () => {
    const { objects, status, report, run } = setup({ "f.pdf": Buffer.from("%PDF") });

    const outcome = await run("f.pdf");
    expect(outcome.kind).toBe("rejected");
    expect(objects.opened).toEqual([]);
    expect(status.rows.get(JOB)).toMatchObject({ status: "fail", failReason: expect.stringContaining(".pdf") });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("rejects an oversized spreadsheet from its HEAD size, before downloading it", async () => {
    const { objects, report, run } = setup({ "big.xlsx": Buffer.from("x") }, { "big.xlsx": 50 * 1024 * 1024 });

    await expect(run("big.xlsx")).resolves.toMatchObject({ kind: "rejected" });
    expect(objects.opened).toEqual([]);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("limited") }));
  });

  it("does not report 'completed' for a file with no data rows", async () => {
    const { status, report, run } = setup({ "empty.csv": Buffer.from("Name,Email\n") });

    await expect(run("empty.csv")).resolves.toMatchObject({ kind: "rejected" });
    expect(status.rows.get(JOB)?.status).toBe("fail");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("rethrows transient errors and only reports failure on the final attempt", async () => {
    const { report, status, run } = setup({});

    await expect(run("missing.csv", false)).rejects.toThrow("NoSuchKey");
    expect(report).not.toHaveBeenCalled();
    expect(status.rows.get(JOB)?.status).toBe("progress");

    await expect(run("missing.csv", true)).rejects.toThrow("NoSuchKey");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
    expect(status.rows.get(JOB)?.status).toBe("fail");
  });
});
