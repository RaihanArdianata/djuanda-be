import { describe, expect, test } from "bun:test";
import type { AlertContext } from "../../types";
import { areaPenetrationRule } from "./area-penetration.rule";

const now = new Date();

const trackInside = {
  trackId: "T1",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.39,
  longitude: 112.785,
  timestamp: now,
};

const trackOutside = {
  trackId: "T2",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.41,
  longitude: 112.785,
  timestamp: now,
};

const area = {
  id: "RESTRICTED-1",
  type: "RESTRICTED",
  polygon: [
    [-7.4, 112.77],
    [-7.4, 112.8],
    [-7.38, 112.8],
    [-7.38, 112.77],
  ] as [number, number][],
};

describe("areaPenetrationRule", () => {
  test("creates an alert for a track inside a restricted area", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside],
    };
    const results = areaPenetrationRule.evaluate(ctx, { areas: [area] });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("AREA_PENETRATION");
    expect(results[0].trackId).toBe("T1");
    expect(results[0].data.areaId).toBe("RESTRICTED-1");
  });
  test("does not create an alert for a track outside the area", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOutside],
    };
    const results = areaPenetrationRule.evaluate(ctx, { areas: [area] });

    expect(results.length).toBe(0);
  });
});
