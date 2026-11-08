import { describe, expect, it } from "bun:test";
import type { TimelineEvent } from "../schema/playback.schema";
import { contextInForceAtSeek, cursorIndexAfterSeek } from "./timeline-cursor";

const event = (ts: number): TimelineEvent => ({
  type: "notam",
  ts,
  timestamp: new Date(ts).toISOString(),
  data: null,
});
const timeline = [event(1000), event(1000), event(2000)];

describe("contextInForceAtSeek", () => {
  const typed = (
    type: TimelineEvent["type"],
    ts: number,
    data: unknown = {},
  ): TimelineEvent => ({
    type,
    ts,
    timestamp: new Date(ts).toISOString(),
    data,
  });
  const cursor = Date.parse("2026-11-08T01:00:00.000Z");
  const before = cursor - 1000;
  const inForce = { effectiveTo: "2026-11-08T02:00:00.000Z" };

  it("mengirim NOTAM, ASHTAM, dan aerodrome yang sudah muncul", () => {
    const notam = typed("notam", before, inForce);
    const ashtam = typed("ashtam", before, inForce);
    const aerodrome = typed("aerodrome", before);

    expect(contextInForceAtSeek([notam, ashtam, aerodrome], cursor)).toEqual([
      notam,
      ashtam,
      aerodrome,
    ]);
  });

  it("tidak mengirim yang masa berlakunya sudah habis", () => {
    const expired = typed("notam", before, {
      effectiveTo: "2026-11-08T00:59:59.000Z",
    });

    expect(contextInForceAtSeek([expired], cursor)).toEqual([]);
  });

  it("menganggap masa berlaku kosong masih berlaku", () => {
    const open = typed("ashtam", before, { effectiveTo: null });

    expect(contextInForceAtSeek([open], cursor)).toEqual([open]);
  });

  it("tidak mengirim event yang bukan konteks", () => {
    const track = typed("aircraft_track", before);
    const aftn = typed("aftn", before);

    expect(contextInForceAtSeek([track, aftn], cursor)).toEqual([]);
  });

  it("menyerahkan event di posisi tujuan atau sesudahnya ke tick", () => {
    const atCursor = typed("notam", cursor, inForce);
    const later = typed("notam", cursor + 1000, inForce);

    expect(contextInForceAtSeek([atCursor, later], cursor)).toEqual([]);
  });
});

describe("cursorIndexAfterSeek", () => {
  it("menyertakan event yang tepat di posisi tujuan", () => {
    expect(cursorIndexAfterSeek(timeline, 1000)).toBe(0);
  });

  it("melewati event sebelum posisi tujuan", () => {
    expect(cursorIndexAfterSeek(timeline, 1500)).toBe(2);
  });

  it("berhenti di akhir timeline bila tidak ada event tersisa", () => {
    expect(cursorIndexAfterSeek(timeline, 3000)).toBe(3);
  });
});
