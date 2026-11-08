import { describe, expect, it } from "bun:test";
import type { TimelineEvent } from "../schema/playback.schema";
import { cursorIndexAfterSeek } from "./timeline-cursor";

const event = (ts: number): TimelineEvent => ({
  type: "notam",
  ts,
  timestamp: new Date(ts).toISOString(),
  data: null,
});
const timeline = [event(1000), event(1000), event(2000)];

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
