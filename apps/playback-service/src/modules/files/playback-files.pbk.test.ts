import { describe, expect, it } from "bun:test";
import { gzipSync } from "node:zlib";
import { parsePbk } from "./playback-files.pbk";

const header = { type: "metadata", format: "pbk", version: 1 };
const event = (ts: number) => ({
  type: "aircraft_track",
  ts,
  timestamp: new Date(ts).toISOString(),
  data: { trackId: `T${ts}` },
});
const pbk = (...lines: unknown[]): Buffer =>
  gzipSync(`${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);

describe("parsePbk", () => {
  it("returns the events sorted by timestamp", () => {
    const events = parsePbk(pbk(header, event(3000), event(1000), event(2000)));

    expect(events.map((e) => e.ts)).toEqual([1000, 2000, 3000]);
  });

  it("menerima event aftn", () => {
    const events = parsePbk(
      pbk(header, {
        type: "aftn",
        ts: 1,
        timestamp: "1970-01-01T00:00:00.001Z",
        data: { messageType: "FPL" },
      }),
    );

    expect(events[0].type).toBe("aftn");
  });

  it("rejects data that is not gzip", () => {
    expect(() => parsePbk(Buffer.from("not gzip"))).toThrow("valid gzip");
  });

  it("rejects an empty file", () => {
    expect(() => parsePbk(gzipSync(""))).toThrow("empty");
  });

  it("rejects a missing or wrong metadata header", () => {
    expect(() => parsePbk(pbk(event(1000)))).toThrow("metadata header");
    expect(() =>
      parsePbk(pbk({ ...header, format: "other" }, event(1))),
    ).toThrow("metadata header");
  });

  it("rejects a header without events", () => {
    expect(() => parsePbk(pbk(header))).toThrow("no events");
  });

  it("reports malformed JSON with the line number", () => {
    const body = gzipSync(`${JSON.stringify(header)}\n{broken\n`);

    expect(() => parsePbk(body)).toThrow("Invalid JSON on line 2");
  });

  it("reports an invalid TimelineEvent with the line number", () => {
    expect(() => parsePbk(pbk(header, event(1000), { type: "nope" }))).toThrow(
      "Invalid TimelineEvent on line 3",
    );
  });
});
