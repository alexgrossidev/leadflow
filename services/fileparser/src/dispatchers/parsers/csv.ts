import csvParser from "csv-parser";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { normalizeRow } from "../pipeline/rows.js";
import type { RawRecord } from "../pipeline/types.js";

export type RowConsumer = (
  rows: AsyncIterable<RawRecord> | Iterable<RawRecord>,
) => Promise<void>;

const DELIMITER_CANDIDATES = [",", ";", "\t"] as const;

/**
 * Picks the separator that occurs most often in the header line. Spreadsheet
 * software in many European locales exports CSV with ";", and parsing such a
 * file with "," would silently put the whole row into the first column.
 */
export function detectDelimiter(headerLine: string): string {
  let best: string = ",";
  let bestCount = 0;
  for (const candidate of DELIMITER_CANDIDATES) {
    const occurrences = headerLine.split(candidate).length - 1;
    if (occurrences > bestCount) {
      best = candidate;
      bestCount = occurrences;
    }
  }
  return best;
}

function toBuffer(chunk: unknown): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (typeof chunk === "string") return Buffer.from(chunk);
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  throw new TypeError("CSV source must yield bytes or strings");
}

/** Enough for any real header line; bounds what is held before parsing. */
const HEADER_SNIFF_LIMIT = 64 * 1024;

/**
 * Reads chunks until the first line break (or HEADER_SNIFF_LIMIT bytes) to
 * sniff the delimiter, then hands back a stream that replays those chunks
 * followed by the rest of the source. Nothing beyond the header is buffered.
 */
async function sniffDelimiter(
  source: Readable,
): Promise<{ stream: Readable; separator: string }> {
  const iterator = source[Symbol.asyncIterator]();
  const head: Buffer[] = [];
  let headBytes = 0;

  while (headBytes < HEADER_SNIFF_LIMIT) {
    const next = await iterator.next();
    if (next.done) break;
    const chunk = toBuffer(next.value);
    head.push(chunk);
    headBytes += chunk.length;
    if (chunk.includes(0x0a)) break;
  }

  const headerBytes = Buffer.concat(head, headBytes);
  const headerLine = headerBytes.toString("utf8").split(/\r?\n/, 1)[0] ?? "";

  async function* replay(): AsyncGenerator<Buffer> {
    // One chunk, so the parser sees the whole first line: csv-parser infers the
    // line ending from it and mistakes CRLF for CR when "\r" ends a chunk.
    if (headBytes > 0) yield headerBytes;
    // Iterating the same iterator (not the stream again) continues after the
    // buffered chunks; an early exit calls iterator.return(), destroying the source.
    for await (const chunk of { [Symbol.asyncIterator]: () => iterator }) {
      yield toBuffer(chunk);
    }
  }

  return {
    stream: Readable.from(replay(), { objectMode: false }),
    separator: detectDelimiter(headerLine),
  };
}

async function* normalized(
  rows: AsyncIterable<Record<string, unknown>>,
): AsyncGenerator<RawRecord> {
  for await (const row of rows) {
    const record = normalizeRow(row);
    if (record) yield record;
  }
}

/**
 * Streams a CSV file (first line = headers) into `consume` as row objects.
 * Memory use is bounded by the stream buffers, not the file size: the parser is
 * only read as fast as `consume` pulls, and a failure anywhere (source, parser,
 * consumer) tears down the whole pipeline and rejects.
 */
export async function parseCsv(
  source: Readable,
  consume: RowConsumer,
): Promise<void> {
  const { stream, separator } = await sniffDelimiter(source);
  const parser = csvParser({
    separator,
    // Excel prefixes UTF-8 CSV exports with a BOM that would otherwise end up
    // in the first header. Blank headers drop their column.
    mapHeaders: ({ header }) => header.replace(/^﻿/, "").trim() || null,
  });

  // On Node 22, pipeline() can reject with its own AbortError when the final
  // stage throws, hiding the cause. Keep the consumer's error and prefer it.
  let consumerError: unknown;
  try {
    await pipeline(stream, parser, async (rows: AsyncIterable<Record<string, unknown>>) => {
      try {
        await consume(normalized(rows));
      } catch (err) {
        consumerError = err;
        throw err;
      }
    });
  } catch (err) {
    throw consumerError ?? err;
  }
}
