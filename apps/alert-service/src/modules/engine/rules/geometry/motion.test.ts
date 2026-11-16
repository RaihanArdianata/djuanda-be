import { describe, expect, test } from "bun:test";
import type { MovementTrack } from "../../types";
import { haversineMeters } from "./geometry";
import { approach, projectTrack } from "./motion";

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 110_400;

const at = (
  east: number,
  north: number,
  speed: number,
  heading: number,
): MovementTrack => ({
  trackId: "t",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.375 + north / M_PER_DEG_LAT,
  longitude: 112.775 + east / M_PER_DEG_LON,
  groundSpeed: speed,
  heading,
  timestamp: new Date(),
});

describe("projectTrack", () => {
  test("moves along the heading at the ground speed", () => {
    const t = at(0, 0, 10, 90); // 10 kt due east
    const p = projectTrack(t, 10);
    expect(haversineMeters([t.latitude, t.longitude], p)).toBeCloseTo(51.4, 0);
    expect(p[0]).toBeCloseTo(t.latitude, 6); // no northward drift
    expect(p[1]).toBeGreaterThan(t.longitude);
  });

  test("a standing target, or one without a heading, stays where it is", () => {
    const standing = at(0, 0, 0, 90);
    expect(projectTrack(standing, 10)).toEqual([
      standing.latitude,
      standing.longitude,
    ]);
    const noHeading = { ...at(0, 0, 10, 90), heading: undefined };
    expect(projectTrack(noHeading, 10)).toEqual([
      noHeading.latitude,
      noHeading.longitude,
    ]);
  });
});

describe("approach", () => {
  test("closing: one is heading straight for a standing one", () => {
    const a = approach(at(0, 0, 10, 90), at(70, 0, 0, 0), 10);
    expect(a.distanceM).toBeCloseTo(70, 0);
    expect(a.closing).toBe(true);
    expect(a.closestM).toBeLessThan(20);
  });

  test("not closing: two standing targets", () => {
    const a = approach(at(0, 0, 0, 0), at(30, 0, 0, 0), 10);
    expect(a.closing).toBe(false);
    expect(a.closestM).toBeCloseTo(30, 0);
  });

  test("not closing: one following the other at the same speed", () => {
    const a = approach(at(0, 0, 12, 90), at(60, 0, 12, 90), 10);
    expect(a.closing).toBe(false);
  });

  test("not closing: moving apart", () => {
    const a = approach(at(0, 0, 12, 270), at(50, 0, 12, 90), 10);
    expect(a.closing).toBe(false);
  });

  test("passing each other still counts as closing: the closest point is in the middle of the horizon", () => {
    // Head-on at 10 kt each from 60 m: they meet after about 6 s and are apart again at 10 s.
    const a = approach(at(0, 0, 10, 90), at(60, 0, 10, 270), 10);
    expect(a.closing).toBe(true);
    expect(a.closestM).toBeLessThan(10);
  });
});
