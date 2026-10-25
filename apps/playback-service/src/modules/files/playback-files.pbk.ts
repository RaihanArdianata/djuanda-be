import { gunzipSync, gzipSync } from "node:zlib";
import ApiError from "@repo/shared/api-error";
import type { TimelineEvent } from "../schema/playback.schema";
import { timelineEventSchema } from "../schema/playback.schema";

const invalid = (message: string): ApiError =>
  new ApiError("BAD_REQUEST", { message });

const parseLine = (line: string, lineNumber: number): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    throw invalid(`Invalid JSON on line ${lineNumber}`);
  }
};
export interface PbkHeader {
  type: "metadata";
  format: "pbk";
  from?: string;
  to?: string;
  [key: string]: unknown;
}

export function parsePbk(compressed: Buffer): TimelineEvent[] {
  return parsePbkWithHeader(compressed).events;
}

/**
 * Full-validates an uploaded .pbk (gzip or plain JSONL) and returns the gzip
 * bytes to store. Plain JSONL is compressed here so storage, download and
 * playback only ever see the canonical gzip form.
 */
export function normalizePbkUpload(
  raw: Buffer,
  encoding: "gzip" | "jsonl",
): Buffer {
  const gz = encoding === "jsonl" ? gzipSync(raw) : raw;
  parsePbkWithHeader(gz); // throws BAD_REQUEST before anything hits storage
  return gz;
}

export function parsePbkWithHeader(compressed: Buffer): {
  header: PbkHeader;
  events: TimelineEvent[];
} {
  let text: string;
  try {
    text = gunzipSync(compressed).toString("utf8");
  } catch {
    throw invalid("PBK file is not a valid gzip stream");
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw invalid("PBK file is empty");

  const header = parseLine(lines[0], 1) as {
    type?: unknown;
    format?: unknown;
  } | null;
  if (header?.type !== "metadata" || header.format !== "pbk") {
    throw invalid("Invalid PBK metadata header");
  }
  if (lines.length < 2) throw invalid("PBK file contains no events");

  const events: TimelineEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    const result = timelineEventSchema.safeParse(parseLine(lines[i], i + 1));
    if (!result.success)
      throw invalid(`Invalid TimelineEvent on line ${i + 1}`);
    events.push(result.data);
  }

  return {
    header: header as PbkHeader,
    events: events.sort((a, b) => a.ts - b.ts),
  };
}
