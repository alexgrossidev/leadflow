import { read, utils } from "xlsx";
import { FileTooLargeError, PermanentImportError } from "../pipeline/errors.js";
import { normalizeRow } from "../pipeline/rows.js";
import type { RawRecord } from "../pipeline/types.js";

/**
 * Collects a stream into one Buffer, failing as soon as it grows past
 * `maxBytes`. The caller also checks the object size up front (HEAD); this is
 * the backstop for a missing Content-Length or an object replaced in between.
 */
export async function readToBuffer(
  source: AsyncIterable<unknown>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    total += buffer.length;
    // Leaving the loop early destroys the source stream.
    if (total > maxBytes) throw new FileTooLargeError(total, maxBytes);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

/**
 * Parses the first worksheet (row 1 = headers) into row objects.
 *
 * SheetJS cannot stream .xlsx (a zip of XML parts), so this is deliberately
 * in-memory: the whole workbook and every parsed row are held at once. The
 * bound is the IMPORT_MAX_BYTES check applied before the download; compressed
 * size is not proportional to parsed size, so a file at the limit can still
 * need several hundred MB of heap.
 */
export function parseWorkbook(file: Buffer): RawRecord[] {
  const workbook = read(file, { type: "buffer", cellDates: true, dense: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new PermanentImportError("Workbook has no worksheets");
  }

  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const records: RawRecord[] = [];
  for (const row of rows) {
    const record = normalizeRow(row);
    if (record) records.push(record);
  }
  return records;
}
