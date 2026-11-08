import { describe, expect, it } from "bun:test";
import {
  admit,
  type GatePoint,
  MAX_REJECTS,
  newGateState,
  plausibleStep,
} from "./track-gate";

const LAT = -7.38;
const LON = 112.79;
const T0 = Date.parse("2026-11-08T07:00:00Z");
const eastDeg = (m: number): number =>
  m / (111_320 * Math.cos((LAT * Math.PI) / 180));
const at = (sec: number, eastM: number, speedKt = 10): GatePoint => ({
  latitude: LAT,
  longitude: LON + eastDeg(eastM),
  groundSpeed: speedKt,
  at: T0 + sec * 1000,
});

describe("plausibleStep", () => {
  it("accepts a distance the aircraft could cover and refuses a jump", () => {
    expect(plausibleStep(at(0, 0), at(5, 30))).toBe(true);
    expect(plausibleStep(at(0, 0), at(1, 400))).toBe(false);
  });

  it("refuses a report that does not move forward in time", () => {
    expect(plausibleStep(at(5, 0), at(5, 1))).toBe(false);
    expect(plausibleStep(at(5, 0), at(2, 1))).toBe(false);
  });

  it("lets a fast aircraft cover more ground", () => {
    expect(plausibleStep(at(0, 0, 150), at(10, 700, 150))).toBe(true);
  });
});

describe("admit", () => {
  it("lets the first report in", () => {
    expect(admit(undefined, at(0, 0), newGateState())).toBe(true);
  });

  it("keeps one path when a second sensor reports 250 m away every other second", () => {
    const state = newGateState();
    let last: GatePoint | undefined;
    const kept: GatePoint[] = [];
    for (let s = 0; s < 20; s++) {
      const p = at(s, s * 8 + (s % 2 === 0 ? 0 : 250));
      if (admit(last, p, state)) {
        kept.push(p);
        last = p;
      }
    }
    // the first report fixes the path; the other sensor's reports never get in
    for (const p of kept) {
      const idx = Math.round((p.at - T0) / 1000);
      expect(idx % 2).toBe(0);
    }
    expect(kept.length).toBeGreaterThan(8);
  });

  it("moves to the new path after MAX_REJECTS reports in a row", () => {
    const state = newGateState();
    const last = at(0, 0);
    const results: boolean[] = [];
    for (let i = 1; i <= MAX_REJECTS; i++) {
      results.push(admit(last, at(i, 500 + i), state));
    }
    expect(results).toEqual([false, false, true]);
  });
});
