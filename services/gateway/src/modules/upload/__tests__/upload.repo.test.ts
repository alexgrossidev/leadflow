import { describe, it, expect, vi, beforeEach } from "vitest";
import { and, notInArray } from "drizzle-orm";
import { csvLargeUpload } from "../upload.table.js";
import type { ImportResultReportPayload } from "@leadflow/shared/jobs";

// Spy on the operators while keeping their real implementations (so the table
// definition in upload.table.ts still builds correctly).
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    and: vi.fn((...args: Parameters<typeof actual.and>) => actual.and(...args)),
    eq: vi.fn((...args: Parameters<typeof actual.eq>) => actual.eq(...args)),
    notInArray: vi.fn((...args: Parameters<typeof actual.notInArray>) => actual.notInArray(...args)),
  };
});

const mocks = vi.hoisted(() => {
  const updateChain = {
    set: vi.fn((_values: Record<string, unknown>): unknown => updateChain),
    where: vi.fn((): Promise<unknown> => Promise.resolve(undefined)),
  };
  return { updateChain, mockUpdate: vi.fn(() => updateChain) };
});

vi.mock("#database/mainPool", () => ({
  mainDb: { update: mocks.mockUpdate },
}));

const { CsvLargeUploadRepository } = await import("../upload.repo.js");

const makeResult = (
  overrides: Partial<ImportResultReportPayload> = {},
): ImportResultReportPayload => ({
  importJobId: "job-1",
  businessId: 10,
  status: "processing",
  totalRows: 100,
  processedRows: 40,
  ...overrides,
});

describe("CsvLargeUploadRepository.applyResult idempotency", () => {
  let repo: InstanceType<typeof CsvLargeUploadRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new CsvLargeUploadRepository();
    mocks.updateChain.set.mockReturnValue(mocks.updateChain);
    mocks.updateChain.where.mockReturnValue(Promise.resolve(undefined));
  });

  it("guards non-terminal events so they cannot overwrite a terminal row", async () => {
    await repo.applyResult(makeResult({ status: "processing" }));

    // The guard must exclude rows already in a terminal state.
    expect(notInArray).toHaveBeenCalledWith(csvLargeUpload.status, [
      "completed",
      "failed",
    ]);
    expect(and).toHaveBeenCalled();

    // A non-terminal event must not stamp completed_at.
    const setArg = mocks.updateChain.set.mock.calls[0]![0];
    expect(setArg.completed_at).toBeUndefined();
    expect(setArg.status).toBe("processing");
  });

  it("applies terminal events unguarded and stamps completed_at", async () => {
    await repo.applyResult(makeResult({ status: "completed" }));

    // Terminal writes are not gated on current status.
    expect(notInArray).not.toHaveBeenCalled();

    const setArg = mocks.updateChain.set.mock.calls[0]![0];
    expect(setArg.completed_at).toBeInstanceOf(Date);
    expect(setArg.status).toBe("completed");
  });

  it("guards 'failed' as terminal (stamped, not gated)", async () => {
    await repo.applyResult(makeResult({ status: "failed", failedRows: 5 }));

    expect(notInArray).not.toHaveBeenCalled();
    const setArg = mocks.updateChain.set.mock.calls[0]![0];
    expect(setArg.completed_at).toBeInstanceOf(Date);
    expect(setArg.failedRows).toBe(5);
  });
});
