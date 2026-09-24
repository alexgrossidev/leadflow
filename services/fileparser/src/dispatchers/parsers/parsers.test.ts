import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import { FileTooLargeError, PermanentImportError } from "../pipeline/errors.js";
import type { RawRecord } from "../pipeline/types.js";
import { detectDelimiter, parseCsv } from "./csv.js";
import { detectFileKind } from "./index.js";
import { parseWorkbook, readToBuffer } from "./xlsx.js";

async function csvRows(text: string, chunkSize = 7): Promise<RawRecord[]> {
  const bytes = Buffer.from(text, "utf8");
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) chunks.push(bytes.subarray(i, i + chunkSize));
  const rows: RawRecord[] = [];
  await parseCsv(Readable.from(chunks, { objectMode: false }), async (source) => {
    for await (const row of source) rows.push(row);
  });
  return rows;
}

function xlsxFixture(aoa: unknown[][]): Buffer {
  const book = utils.book_new();
  utils.book_append_sheet(book, utils.aoa_to_sheet(aoa), "Customers");
  return write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("detectFileKind", () => {
  it.each([
    ["uploads/a.csv", "csv"],
    ["uploads/A.CSV", "csv"],
    ["uploads/a.xlsx", "spreadsheet"],
    ["uploads/a.xls", "spreadsheet"],
  ])("%s -> %s", (key, kind) => {
    expect(detectFileKind(key)).toBe(kind);
  });

  it.each(["uploads/a.pdf", "uploads/a.numbers", "uploads/noextension"])(
    "rejects %s as a permanent error",
    (key) => {
      expect(() => detectFileKind(key)).toThrow(PermanentImportError);
    },
  );
});

describe("detectDelimiter", () => {
  it.each([
    ["name,email,phone", ","],
    ["name;email;phone", ";"],
    ["name\temail\tphone", "\t"],
    ["single", ","],
  ])("%j -> %j", (header, expected) => {
    expect(detectDelimiter(header)).toBe(expected);
  });
});

describe("parseCsv", () => {
  it("turns the header row into keys and every line into an object, across chunk boundaries", async () => {
    const rows = await csvRows(
      "Name,Email,Phone,City\nAda,ada@example.com,111,London\nGrace,grace@example.com,222,\"New York, NY\"\n",
    );
    expect(rows).toEqual([
      { Name: "Ada", Email: "ada@example.com", Phone: "111", City: "London" },
      { Name: "Grace", Email: "grace@example.com", Phone: "222", City: "New York, NY" },
    ]);
  });

  it("handles semicolon files, CRLF, a UTF-8 BOM and blank lines", async () => {
    const rows = await csvRows("﻿Name;Email\r\nAda;ada@example.com\r\n;\r\n\r\nGrace;g@example.com\r\n");
    expect(rows).toEqual([
      { Name: "Ada", Email: "ada@example.com" },
      { Name: "Grace", Email: "g@example.com" },
    ]);
  });

  it("drops columns whose header is blank", async () => {
    const rows = await csvRows("Name,,Email\nAda,junk,ada@example.com\n");
    expect(rows).toEqual([{ Name: "Ada", Email: "ada@example.com" }]);
  });

  it("yields nothing for a header-only file", async () => {
    expect(await csvRows("Name,Email\n")).toEqual([]);
  });

  it("rejects when the source stream fails midway", async () => {
    async function* broken() {
      yield Buffer.from("Name,Email\nAda,a@example.com\n");
      throw new Error("connection reset");
    }
    await expect(
      parseCsv(Readable.from(broken(), { objectMode: false }), async (rows) => {
        for await (const _ of rows) void _;
      }),
    ).rejects.toThrow("connection reset");
  });

  it("rejects when the consumer fails, without hanging", async () => {
    const text = "Name\n" + Array.from({ length: 5000 }, (_, i) => `row${i}`).join("\n");
    await expect(
      parseCsv(Readable.from([Buffer.from(text)], { objectMode: false }), async (rows) => {
        for await (const _ of rows) throw new Error("database down");
      }),
    ).rejects.toThrow("database down");
  });
});

describe("parseWorkbook", () => {
  it("parses the first sheet into keyed rows, skipping empty rows and header-less columns", () => {
    const file = xlsxFixture([
      ["Name", "Email", "Phone", null, "Signed up"],
      ["Ada", "ada@example.com", 393331234567, "stray", new Date(Date.UTC(2024, 0, 15))],
      [null, null, null, null, null],
      ["Grace", "grace@example.com", null, null, null],
    ]);

    const rows = parseWorkbook(file);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Name: "Ada", Email: "ada@example.com", Phone: 393331234567 });
    expect(rows[0]).not.toHaveProperty("__EMPTY");
    expect(typeof rows[0]?.["Signed up"]).toBe("string");
    expect(rows[1]).toEqual({ Name: "Grace", Email: "grace@example.com", Phone: null, "Signed up": null });
  });
});

describe("readToBuffer", () => {
  it("collects a stream within the limit", async () => {
    const buffer = await readToBuffer(Readable.from([Buffer.from("abc"), Buffer.from("def")]), 6);
    expect(buffer.toString()).toBe("abcdef");
  });

  it("stops reading as soon as the limit is exceeded", async () => {
    let pulled = 0;
    async function* endless() {
      for (;;) {
        pulled++;
        yield Buffer.alloc(1024);
      }
    }
    await expect(readToBuffer(endless(), 4096)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(pulled).toBe(5);
  });
});
