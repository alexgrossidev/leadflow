import { Readable } from "node:stream";
import type { ImportStatusValue } from "#config/constants";
import type { ObjectStore } from "#core/objectStore";
import type {
  ImportStatusSnapshot,
  ImportStatusStore,
  RawRecord,
  StagedRow,
  StagingRecord,
  StagingStore,
} from "#dispatchers/pipeline/types";

interface FakeRow {
  id: number;
  importJobId: string;
  rawData: RawRecord;
  hash: string;
  status: "RAW" | "DELIVERED";
}

/** In-memory import_staging with the same dedup and keyset semantics as MySQL. */
export class FakeStagingStore implements StagingStore {
  readonly rows: FakeRow[] = [];
  private nextId = 1;
  private readonly hashes = new Set<string>();
  insertCalls = 0;

  async insertRaw(importJobId: string, _businessId: number, records: StagingRecord[]) {
    this.insertCalls++;
    for (const record of records) {
      const key = `${importJobId}:${record.dataHash.toString("hex")}`;
      if (this.hashes.has(key)) continue;
      this.hashes.add(key);
      this.rows.push({
        id: this.nextId++,
        importJobId,
        rawData: record.rawData,
        hash: record.dataHash.toString("hex"),
        status: "RAW",
      });
    }
  }

  async readUndeliveredPage(importJobId: string, afterId: number, limit: number): Promise<StagedRow[]> {
    return this.rows
      .filter((r) => r.importJobId === importJobId && r.status === "RAW" && r.id > afterId)
      .slice(0, limit)
      // mysql2 hands JSON columns back parsed; a copy stops tests mutating state.
      .map((r) => ({ id: r.id, rawData: structuredClone(r.rawData) }));
  }

  async markDelivered(importJobId: string, ids: number[]) {
    const set = new Set(ids);
    for (const row of this.rows) {
      if (row.importJobId === importJobId && set.has(row.id)) row.status = "DELIVERED";
    }
  }

  async countUndelivered(importJobId: string) {
    return this.rows.filter((r) => r.importJobId === importJobId && r.status === "RAW").length;
  }

  async countDelivered(importJobId: string) {
    return this.rows.filter((r) => r.importJobId === importJobId && r.status === "DELIVERED").length;
  }
}

export class FakeStatusStore implements ImportStatusStore {
  readonly rows = new Map<string, ImportStatusSnapshot & { failReason?: string }>();

  constructor(private readonly now: () => number = Date.now) {}

  async set(importJobId: string, status: ImportStatusValue, failReason?: string) {
    const existing = this.rows.get(importJobId);
    this.rows.set(importJobId, {
      status,
      failReason,
      rescheduleCount: existing?.rescheduleCount ?? 0,
      createdAt: existing?.createdAt ?? new Date(this.now()),
    });
  }

  async get(importJobId: string) {
    const row = this.rows.get(importJobId);
    return row ? { ...row } : null;
  }

  async incrementReschedule(importJobId: string) {
    const row = this.rows.get(importJobId);
    if (row) row.rescheduleCount++;
  }
}

/** Serves fixed buffers; `sizes` can report a HEAD size different from the body. */
export class FakeObjectStore implements ObjectStore {
  opened: string[] = [];

  constructor(
    private readonly files: Record<string, Buffer>,
    private readonly sizes: Record<string, number> = {},
  ) {}

  async sizeOf(key: string) {
    return this.sizes[key] ?? this.files[key]?.length;
  }

  async open(key: string) {
    const file = this.files[key];
    if (!file) throw new Error(`NoSuchKey: ${key}`);
    this.opened.push(key);
    // Small chunks so parsers see a realistic multi-chunk stream.
    const chunks: Buffer[] = [];
    for (let i = 0; i < file.length; i += 1024) chunks.push(file.subarray(i, i + 1024));
    return Readable.from(chunks, { objectMode: false });
  }
}
