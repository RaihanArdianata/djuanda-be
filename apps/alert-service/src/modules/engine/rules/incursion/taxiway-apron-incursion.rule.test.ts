import { describe, expect, test } from "bun:test";
import type { AlertContext } from "../../types";
import { taxiwayApronIncursionRule } from "./taxiway-apron-incursion.rule";

const now = new Date();

const surface = {
  id: "TAXI-01",
  type: "TAXIWAY",
  polygon: [
    [-7.38, 112.76],
    [-7.38, 112.79],
    [-7.37, 112.79],
    [-7.37, 112.76],
  ] as [number, number][],
};

const trackInside = {
  trackId: "T1",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.375,
  longitude: 112.775,
  timestamp: now,
};

const trackOutside = {
  trackId: "T2",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.42,
  longitude: 112.775,
  timestamp: now,
};

const expectedRoute: [number, number][] = [
  [-7.385, 112.77],
  [-7.385, 112.78],
];

describe("taxiwayApronIncursionRule", () => {
  test("creates an alert for a track inside a surface", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      surfaces: [surface],
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("TAXIWAY_APRON_INCURSION");
    expect(results[0].trackId).toBe("T1");
  });

  test("does not create an alert for a track outside surfaces", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOutside],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      surfaces: [surface],
    });

    expect(results.length).toBe(0);
  });

  test("creates an alert when the track is off the expected route", () => {
    const trackOff = {
      ...trackInside,
      trackId: "T3",
      latitude: -7.39,
      longitude: 112.78,
    };
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOff],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 50,
    });

    expect(results.length).toBe(1);
    expect(results[0].data.reason).toBe("OFF_ROUTE");
  });

  test("does not create an alert when the track is on the expected route", () => {
    const trackOn = {
      ...trackInside,
      trackId: "T4",
      latitude: -7.385,
      longitude: 112.775,
    };
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOn],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 50,
    });

    expect(results.length).toBe(0);
  });
});
