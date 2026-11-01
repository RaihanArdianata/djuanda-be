import { describe, expect, it } from "bun:test";

describe("track state timestamp contract", () => {
  it("restores serialized timestamps as Dates before rules consume them", () => {
    const serialized = JSON.stringify({
      trackId: "t1",
      airportId: "WARR",
      timestamp: "2026-11-01T05:00:00.000Z",
    });
    const track = JSON.parse(serialized) as { timestamp: string };

    expect(new Date(track.timestamp).toISOString()).toBe(
      "2026-11-01T05:00:00.000Z",
    );
  });
});
