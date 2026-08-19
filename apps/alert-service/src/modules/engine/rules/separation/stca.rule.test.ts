// biome-ignore-start lint/nursery/useExplicitType: test fixtures
import { describe, expect, test } from "bun:test";
import type { AlertContext } from "../../types";
import { stcaRule } from "./stca.rule";

const now = new Date();

const trackA = {
  trackId: "A",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.385,
  longitude: 112.77,
  altitude: 0,
  groundSpeed: 60,
  heading: 270,
  onGround: true,
  timestamp: now,
};

const trackB = {
  trackId: "B",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.385,
  longitude: 112.7367,
  altitude: 0,
  groundSpeed: 60,
  heading: 90,
  onGround: true,
  timestamp: now,
};

const trackC = {
  trackId: "C",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.4,
  longitude: 112.9,
  altitude: 0,
  groundSpeed: 60,
  heading: 0,
  onGround: true,
  timestamp: now,
};

describe("stcaRule", () => {
  test("generates an STCA when two tracks converge within threshold", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackA, trackB],
    };

    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("STCA");
    expect(results[0].trackId).toBe("A");
    expect(results[0].relatedTrackId).toBe("B");
  });

  test("does not generate an STCA for well separated tracks", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackA, trackC],
    };

    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
    });

    expect(results.length).toBe(0);
  });

  test("does not generate an STCA when vertically separated", () => {
    const trackHigh = {
      ...trackA,
      trackId: "AH",
      altitude: 5000,
    };
    const trackHigher = {
      ...trackB,
      trackId: "BH",
      altitude: 6200,
    };

    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackHigh, trackHigher],
    };

    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
      minimumVerticalSeparationFt: 1000,
    });

    expect(results.length).toBe(0);
  });

  test("generates an STCA when vertical separation is below threshold", () => {
    const trackLow = {
      ...trackA,
      trackId: "AL",
      altitude: 1000,
    };
    const trackLower = {
      ...trackB,
      trackId: "BL",
      altitude: 1500,
    };

    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackLow, trackLower],
    };

    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
      minimumVerticalSeparationFt: 1000,
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("STCA");
    expect(results[0].data.predictedVerticalSeparationFt).toBe(500);
  });
});
// biome-ignore-end lint/nursery/useExplicitType: test fixtures
