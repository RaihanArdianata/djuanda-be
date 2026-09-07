import { describe, expect, test } from "bun:test";
import type { AlertContext } from "../../types";
import { deviationRule } from "./deviation.rule";

const now = new Date();

const expectedRoute: [number, number][] = [
  [-7.385, 112.77],
  [-7.385, 112.78],
];

const trackOn = {
  trackId: "T1",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.385,
  longitude: 112.775,
  altitude: 0,
  timestamp: now,
};

const trackOff = {
  ...trackOn,
  trackId: "T2",
  latitude: -7.39,
  longitude: 112.775,
};

const trackLate = {
  ...trackOn,
  trackId: "T3",
  timestamp: new Date(now.getTime() + 120_000),
};

describe("deviationRule", () => {
  test("does not create an alert when the track is on route and on time", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOn],
    };
    const results = deviationRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 300,
      maximumTimeDeviation: 60,
      expectedRouteTimes: [now.toISOString(), now.toISOString()],
    });

    expect(results.length).toBe(0);
  });

  test("creates an alert when the track is off route", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOff],
    };
    const results = deviationRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 300,
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("DEVIATION");
  });

  test("creates an alert when the track is on route but late", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackLate],
    };
    const results = deviationRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 300,
      maximumTimeDeviation: 60,
      expectedRouteTimes: [now.toISOString(), now.toISOString()],
    });

    expect(results.length).toBe(1);
    expect(results[0].data.timeExceeded).toBe(true);
  });

  test("does not create an alert for high MSL altitude when no expected altitude is configured", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [{ ...trackOn, altitude: 1000 }],
    };
    const results = deviationRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 300,
    });

    expect(results.length).toBe(0);
  });

  test("does not create an alert when altitude is within expected altitude threshold", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [{ ...trackOn, altitude: 1000 }],
    };
    const results = deviationRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 100,
      expectedAltitude: 950,
    });

    expect(results.length).toBe(0);
  });

  test("creates an alert when altitude deviates beyond the expected altitude threshold", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [{ ...trackOn, altitude: 1000 }],
    };
    const results = deviationRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 100,
      expectedAltitude: 2000,
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("DEVIATION");
    expect(results[0].data.altitudeDeviationFt).toBe(-1000);
    expect(results[0].data.expectedAltitude).toBe(2000);
  });

  test("uses expectedRouteAltitudes per nearest route point", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [
        { ...trackOn, latitude: -7.385, longitude: 112.779, altitude: 100 },
      ],
    };
    // Nearest point is index 1 (lon 112.78); expected altitude for that point is 50.
    const results = deviationRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 100,
      expectedRouteAltitudes: [0, 50],
    });

    expect(results.length).toBe(0);

    const resultsExceeded = deviationRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 10,
      expectedRouteAltitudes: [0, 50],
    });

    expect(resultsExceeded.length).toBe(1);
    expect(resultsExceeded[0].data.expectedAltitude).toBe(50);
  });
});
