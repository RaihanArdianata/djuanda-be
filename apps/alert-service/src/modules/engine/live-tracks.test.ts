import { describe, expect, it } from "bun:test";
import { createLiveTracks, trackMaxAgeFromEnv } from "./live-tracks";
import type { MovementTrack } from "./types";

const track = (trackId: string, airportId = "WARR"): MovementTrack =>
  ({
    trackId,
    airportId,
    targetType: "AIRCRAFT",
    latitude: -7.38,
    longitude: 112.78,
    timestamp: new Date(0),
  }) as MovementTrack;

describe("live tracks", () => {
  it("returns only tracks updated within the max age, by the process clock", () => {
    let now = 0;
    const live = createLiveTracks(30_000, () => now);
    live.upsert(track("a"));
    now = 20_000;
    live.upsert(track("b"));
    now = 40_000;
    expect(live.snapshot("WARR").map((t) => t.trackId)).toEqual(["b"]);
    // The stale one is gone for good, not just hidden.
    expect(live.size).toBe(1);
  });

  it("keeps a track alive while it keeps updating, and uses the newest position", () => {
    let now = 0;
    const live = createLiveTracks(30_000, () => now);
    for (let i = 0; i < 5; i++) {
      now += 20_000;
      live.upsert({ ...track("a"), latitude: -7 + i });
    }
    const [only] = live.snapshot("WARR");
    expect(live.snapshot("WARR").length).toBe(1);
    expect(only?.latitude).toBe(-3);
  });

  it("separates airports and drops removed tracks", () => {
    const live = createLiveTracks(30_000, () => 0);
    live.upsert(track("a", "WARR"));
    live.upsert(track("b", "WIII"));
    expect(live.snapshot("WARR").map((t) => t.trackId)).toEqual(["a"]);
    live.remove("WARR", "a");
    expect(live.snapshot("WARR")).toEqual([]);
    expect(live.snapshot("WXYZ")).toEqual([]);
  });

  it("reads the max age from env, defaulting to 30 seconds", () => {
    expect(trackMaxAgeFromEnv({})).toBe(30_000);
    expect(trackMaxAgeFromEnv({ ALERT_TRACK_MAX_AGE_MS: "45000" })).toBe(
      45_000,
    );
    expect(trackMaxAgeFromEnv({ ALERT_TRACK_MAX_AGE_MS: "x" })).toBe(30_000);
  });
});
