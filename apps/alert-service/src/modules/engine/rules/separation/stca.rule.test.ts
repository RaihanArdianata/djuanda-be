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
  altitude: 3000,
  groundSpeed: 60,
  heading: 270,
  onGround: false,
  timestamp: now,
};

const trackB = {
  trackId: "B",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.385,
  longitude: 112.7367,
  altitude: 3000,
  groundSpeed: 60,
  heading: 90,
  onGround: false,
  timestamp: now,
};

const trackC = {
  trackId: "C",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.4,
  longitude: 112.9,
  altitude: 3000,
  groundSpeed: 60,
  heading: 0,
  onGround: false,
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

  describe("targets on the ground are not an STCA matter", () => {
    const cfg = {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
    };
    // Two almost stationary targets on an apron, 0.86 NM apart: inside the 3 NM threshold.
    const parkedA = {
      ...trackA,
      trackId: "PA",
      latitude: -7.374058,
      longitude: 112.78815,
      altitude: 0,
      groundSpeed: 1,
      heading: 117,
      onGround: true,
    };
    const parkedB = {
      ...trackA,
      trackId: "PB",
      latitude: -7.380683,
      longitude: 112.775415,
      altitude: 0,
      groundSpeed: 3,
      heading: 188,
      onGround: true,
    };
    const run = (
      tracks: AlertContext["tracks"],
      config: Record<string, unknown> = cfg,
    ) =>
      stcaRule.evaluate({ airportId: "WARR", timestamp: now, tracks }, config);

    test("two targets on the ground produce no STCA, however close", () => {
      expect(run([parkedA, parkedB]).length).toBe(0);
      expect(
        run([
          parkedA,
          {
            ...parkedB,
            latitude: parkedA.latitude,
            longitude: parkedA.longitude,
          },
        ]).length,
      ).toBe(0);
    });

    test("an airborne target and one on the ground produce no STCA", () => {
      const airborne = {
        ...trackA,
        trackId: "FLY",
        latitude: parkedA.latitude,
        longitude: parkedA.longitude,
      };
      expect(run([airborne, parkedB]).length).toBe(0);
    });

    test("includeSurface brings the old behaviour back", () => {
      expect(
        run([parkedA, parkedB], { ...cfg, includeSurface: true }).length,
      ).toBe(1);
    });

    test("without an onGround flag, only a clearly airborne altitude counts", () => {
      const unflagged = (id: string, altitude: number | undefined) => ({
        ...parkedA,
        trackId: id,
        onGround: undefined,
        altitude,
        groundSpeed: 0,
      });
      // 800 ft: airborne, so the pair is evaluated and (0.9 NM apart) alerts.
      expect(
        run([
          unflagged("U1", 800),
          {
            ...unflagged("U2", 800),
            latitude: parkedB.latitude,
            longitude: parkedB.longitude,
          },
        ]).length,
      ).toBe(1);
      // 100 ft or unknown: treated as the surface, no alert.
      expect(
        run([
          unflagged("U3", 100),
          {
            ...unflagged("U4", 100),
            latitude: parkedB.latitude,
            longitude: parkedB.longitude,
          },
        ]).length,
      ).toBe(0);
      expect(
        run([
          unflagged("U5", undefined),
          {
            ...unflagged("U6", undefined),
            latitude: parkedB.latitude,
            longitude: parkedB.longitude,
          },
        ]).length,
      ).toBe(0);
    });
  });
});
