import { describe, expect, it } from "bun:test";
import { MAX_LIMIT, trailConfigFromEnv } from "./trail-config";

describe("trailConfigFromEnv", () => {
  it("has a default for everything: 100 m spacing, whole flight, marks every 2 minutes, no backfill", () => {
    const c = trailConfigFromEnv({});
    expect(c.enabled).toBe(true);
    expect(c.warnings).toEqual([]);
    expect(c.store).toEqual({
      minDistanceM: 100,
      turnDeg: 10,
      maxGapMs: 30_000,
      maxPointsPerTrack: 20_000,
      maxTracks: 5_000,
      retainAfterRemoveMs: 300_000,
    });
    expect(c).toMatchObject({
      labelEveryMs: 120_000,
      defaultLimit: 5_000,
      dbFallback: true,
      backfillMs: 0,
    });
  });

  it("the spacing in metres is a setting", () => {
    expect(
      trailConfigFromEnv({ TRAIL_MIN_DISTANCE_M: "250" }).store.minDistanceM,
    ).toBe(250);
    expect(
      trailConfigFromEnv({ TRAIL_MIN_DISTANCE_M: "25" }).store.minDistanceM,
    ).toBe(25);
  });

  it("can be switched off, and the database fallback separately", () => {
    for (const v of ["false", "0", "off", "NO", " False "]) {
      expect(trailConfigFromEnv({ TRAIL_ENABLED: v }).enabled).toBe(false);
      expect(trailConfigFromEnv({ TRAIL_DB_FALLBACK: v }).dbFallback).toBe(
        false,
      );
    }
    expect(trailConfigFromEnv({ TRAIL_ENABLED: "true" }).enabled).toBe(true);
  });

  it("reads every number", () => {
    const c = trailConfigFromEnv({
      TRAIL_TURN_DEG: "15",
      TRAIL_MAX_GAP_MS: "10000",
      TRAIL_MAX_POINTS_PER_TRACK: "999.9",
      TRAIL_MAX_TRACKS: "100",
      TRAIL_RETAIN_AFTER_REMOVE_MS: "60000",
      TRAIL_LABEL_EVERY_MS: "60000",
      TRAIL_DEFAULT_LIMIT: "300",
      TRAIL_BACKFILL_MS: "10800000",
    });
    expect(c.store).toMatchObject({
      turnDeg: 15,
      maxGapMs: 10_000,
      maxPointsPerTrack: 999, // whole points
      maxTracks: 100,
      retainAfterRemoveMs: 60_000,
    });
    expect(c).toMatchObject({
      labelEveryMs: 60_000,
      defaultLimit: 300,
      backfillMs: 10_800_000,
    });
    expect(c.warnings).toEqual([]);
  });

  it("0 means 'off' for the time marks and for the backfill, and for nothing else", () => {
    expect(trailConfigFromEnv({ TRAIL_LABEL_EVERY_MS: "0" }).labelEveryMs).toBe(
      0,
    );
    expect(trailConfigFromEnv({ TRAIL_BACKFILL_MS: "0" }).backfillMs).toBe(0);
    const c = trailConfigFromEnv({
      TRAIL_MIN_DISTANCE_M: "0",
      TRAIL_MAX_TRACKS: "0",
    });
    expect(c.store.minDistanceM).toBe(100);
    expect(c.store.maxTracks).toBe(5_000);
    expect(c.warnings).toHaveLength(2);
  });

  it("warns on junk and negative numbers and keeps the default", () => {
    const c = trailConfigFromEnv({
      TRAIL_TURN_DEG: "abc",
      TRAIL_MAX_GAP_MS: "-5",
      TRAIL_LABEL_EVERY_MS: "-1",
    });
    expect(c.store.turnDeg).toBe(10);
    expect(c.store.maxGapMs).toBe(30_000);
    expect(c.labelEveryMs).toBe(120_000);
    expect(c.warnings).toHaveLength(3);
    expect(c.warnings[0]).toContain("TRAIL_TURN_DEG");
  });

  it("a default limit above what one response may carry is capped", () => {
    expect(
      trailConfigFromEnv({ TRAIL_DEFAULT_LIMIT: "999999" }).defaultLimit,
    ).toBe(MAX_LIMIT);
  });
});
