import { describe, expect, it } from "bun:test";
import { resolvePlayableRange } from "./playback-files.range";

const d = (s: string) => new Date(s);

describe("resolvePlayableRange", () => {
  it("uses the requested window for generated files", () => {
    const r = resolvePlayableRange({
      kind: "generated",
      requestedFrom: d("2026-10-20T07:00:00Z"),
      requestedTo: d("2026-10-20T08:00:00Z"),
      recordingFrom: d("2026-10-20T07:00:00Z"),
      recordingTo: d("2026-10-20T07:50:00Z"),
    });
    expect(r?.from.toISOString()).toBe("2026-10-20T07:00:00.000Z");
    expect(r?.to.toISOString()).toBe("2026-10-20T08:00:00.000Z");
  });

  it("uses the header window for imported files", () => {
    const r = resolvePlayableRange({
      kind: "imported",
      stats: {
        headerFrom: "2026-10-20T07:00:00.000Z",
        headerTo: "2026-10-20T08:00:00.000Z",
      },
      recordingFrom: d("2026-10-20T07:10:00Z"),
      recordingTo: d("2026-10-20T07:20:00Z"),
    });
    expect(r?.to.toISOString()).toBe("2026-10-20T08:00:00.000Z");
  });

  it("falls back to the event range and widens to cover all events", () => {
    const r = resolvePlayableRange({
      kind: "imported",
      recordingFrom: d("2026-10-20T07:00:00Z"),
      recordingTo: d("2026-10-20T07:30:00Z"),
    });
    expect(r?.to.toISOString()).toBe("2026-10-20T07:30:00.000Z");
  });

  it("returns null for a collapsed or missing range", () => {
    expect(
      resolvePlayableRange({
        kind: "imported",
        recordingFrom: d("2026-10-20T07:00:00Z"),
        recordingTo: d("2026-10-20T07:00:00Z"),
      }),
    ).toBeNull();
    expect(resolvePlayableRange({ kind: "imported" })).toBeNull();
  });
});
