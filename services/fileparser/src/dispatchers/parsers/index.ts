import type { Readable } from "node:stream";
import { PermanentImportError } from "../pipeline/errors.js";
import { parseCsv, type RowConsumer } from "./csv.js";
import { parseWorkbook, readToBuffer } from "./xlsx.js";

export type FileKind = "csv" | "spreadsheet";

const EXTENSIONS: Record<string, FileKind> = {
  ".csv": "csv",
  ".xlsx": "spreadsheet",
  ".xls": "spreadsheet",
};

/** Maps the storage key's extension to a parser; anything else is rejected. */
export function detectFileKind(fileKey: string): FileKind {
  const match = /\.[a-z0-9]+$/i.exec(fileKey);
  const kind = match ? EXTENSIONS[match[0].toLowerCase()] : undefined;
  if (!kind) {
    throw new PermanentImportError(
      `Unsupported file type "${match?.[0] ?? "(none)"}"; expected .csv, .xlsx or .xls`,
    );
  }
  return kind;
}

/** Parses `source` according to `kind` and feeds its rows to `consume`. */
export async function parseFile(
  kind: FileKind,
  source: Readable,
  consume: RowConsumer,
  maxSpreadsheetBytes: number,
): Promise<void> {
  if (kind === "csv") {
    await parseCsv(source, consume);
    return;
  }
  const file = await readToBuffer(source, maxSpreadsheetBytes);
  await consume(parseWorkbook(file));
}
