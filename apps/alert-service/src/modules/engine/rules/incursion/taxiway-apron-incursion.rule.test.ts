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
  test("does not alert for a lone track on a normal ACTIVE surface", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      surfaces: [{ ...surface, status: "ACTIVE" }],
    });

    expect(results.length).toBe(0);
  });

  test("creates an alert for a single track inside a RESTRICTED surface", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      surfaces: [{ ...surface, status: "RESTRICTED" }],
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("TAXIWAY_APRON_INCURSION");
    expect(results[0].trackId).toBe("T1");
  });

  test("creates an alert for a single track inside an INACTIVE surface", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      surfaces: [{ ...surface, status: "INACTIVE" }],
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("TAXIWAY_APRON_INCURSION");
  });

  test("alerts when a second track enters an occupied ACTIVE surface", () => {
    const other = { ...trackInside, trackId: "T9" };
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside, other],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      surfaces: [{ ...surface, status: "ACTIVE" }],
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("TAXIWAY_APRON_INCURSION");
  });

  test("does not alert for two parked aircraft far apart on the same apron", () => {
    const far = {
      ...trackInside,
      trackId: "T10",
      longitude: 112.788,
    };
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside, far],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      surfaces: [{ ...surface, type: "APRON", status: "ACTIVE" }],
    });

    expect(results.length).toBe(0);
  });

  test("alerts for two aircraft within critical separation on the same apron", () => {
    const close = {
      ...trackInside,
      trackId: "T11",
      longitude: 112.7752,
    };
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside, close],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      surfaces: [{ ...surface, type: "APRON", status: "ACTIVE" }],
      criticalSeparationMeters: 50,
    });

    expect(results.length).toBe(1);
    expect(results[0].severity).toBe("CRITICAL");
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
