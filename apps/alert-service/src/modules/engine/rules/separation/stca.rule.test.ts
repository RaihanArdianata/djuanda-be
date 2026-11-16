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

  test("does not pair a track with its twin of the same callsign", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [
        { ...trackA, callsign: "CTV696" },
        { ...trackA, trackId: "A-twin", callsign: "CTV696" },
      ],
    };

    expect(
      stcaRule.evaluate(ctx, {
        predictionTimeSeconds: 60,
        minimumHorizontalSeparationNm: 3,
      }).length,
    ).toBe(0);
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

    test("a slow, low target flagged onGround=false is still treated as on the ground", () => {
      // Taking-off aircraft (79 kt, 225 ft) and a taxiing target the feed
      // failed to mark as surface (4 kt, 0 ft).
      const takeoff = {
        ...trackA,
        trackId: "LNI690",
        latitude: -7.376198,
        longitude: 112.763892,
        altitude: 225,
        groundSpeed: 79,
        heading: 255,
        onGround: false,
      };
      const taxiing = {
        ...trackA,
        trackId: "ast_twql3gsOVXMR",
        latitude: -7.374358,
        longitude: 112.788118,
        altitude: 0,
        groundSpeed: 4,
        heading: 344,
        onGround: false,
      };
      expect(run([takeoff, taxiing]).length).toBe(0);
    });

    test("includeSurface adds a separate STCA for the ground, with its own threshold in metres", () => {
      // parkedA and parkedB are about 0.86 NM (1600 m) apart: far outside the default ground limit of 50 m ...
      expect(
        run([parkedA, parkedB], { ...cfg, includeSurface: true }).length,
      ).toBe(0);
      // ... but inside a ground limit of 2000 m.
      const results = run([parkedA, parkedB], {
        ...cfg,
        includeSurface: true,
        surfaceMinimumSeparationMeters: 2000,
      });
      expect(results.length).toBe(1);
      expect(results[0].data.domain).toBe("SURFACE");
      expect(results[0].data.minimumSeparationMeters).toBeCloseTo(2000, 0);
      expect(results[0].data.horizontalSeparationMeters).toBeGreaterThan(1000);
    });

    test("the air STCA is marked AIR, and the 3 NM limit does not apply on the ground", () => {
      const air = stcaRule.evaluate(
        { airportId: "WARR", timestamp: now, tracks: [trackA, trackB] },
        { ...cfg, includeSurface: true },
      );
      expect(air.length).toBe(1);
      expect(air[0].data.domain).toBe("AIR");
    });

    test("both STCA kinds can fire in the same picture, and an air and a ground target are never paired", () => {
      const results = run([trackA, trackB, parkedA, parkedB], {
        ...cfg,
        includeSurface: true,
        surfaceMinimumSeparationMeters: 2000,
      });
      expect(results.map((r) => r.data.domain).sort()).toEqual([
        "AIR",
        "SURFACE",
      ]);
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

describe("altitude and vertical separation", () => {
  const cfg = { predictionTimeSeconds: 60, minimumHorizontalSeparationNm: 3 };
  const run = (
    tracks: (typeof trackA)[],
    config: Record<string, unknown> = cfg,
  ) => stcaRule.evaluate({ airportId: "WARR", timestamp: now, tracks }, config);

  // A radar track that carries no altitude, next to an aircraft: converging inside the 3 NM threshold.
  const noAltitude = {
    ...trackA,
    trackId: "R",
    altitude: undefined as unknown as number,
  };

  test("a track with no reported altitude takes no part, it is not an aircraft at 0 ft", () => {
    expect(run([noAltitude, trackB]).length).toBe(0);
  });

  test("requireAltitude: false brings the old behaviour back (horizontal only)", () => {
    expect(
      run([noAltitude, trackB], {
        ...cfg,
        requireAltitude: false,
        minimumVerticalSeparationFt: null,
      }).length,
    ).toBe(1);
  });

  test("when the rule sets no vertical separation, 1000 ft is used", () => {
    const high = { ...trackB, trackId: "H", altitude: 5000 };
    expect(run([trackA, high]).length).toBe(0); // 2000 ft apart
    const near = { ...trackB, trackId: "N", altitude: 3500 };
    expect(run([trackA, near]).length).toBe(1); // 500 ft apart
  });

  test("minimumVerticalSeparationFt: 0 or null switches the vertical check off", () => {
    const high = { ...trackB, trackId: "H", altitude: 9000 };
    expect(
      run([trackA, high], { ...cfg, minimumVerticalSeparationFt: null }).length,
    ).toBe(1);
    expect(
      run([trackA, high], { ...cfg, minimumVerticalSeparationFt: 0 }).length,
    ).toBe(1);
  });

  test("a configured vertical separation overrides the default", () => {
    const apart = { ...trackB, trackId: "H", altitude: 4500 }; // 1500 ft apart
    expect(
      run([trackA, apart], { ...cfg, minimumVerticalSeparationFt: 2000 })
        .length,
    ).toBe(1);
    expect(
      run([trackA, apart], { ...cfg, minimumVerticalSeparationFt: 1000 })
        .length,
    ).toBe(0);
  });
});

describe("stcaRule: closest approach within the prediction time", () => {
  const run = (
    tracks: AlertContext["tracks"],
    config: Record<string, unknown> = {},
  ) =>
    stcaRule.evaluate(
      { airportId: "WARR", timestamp: now, tracks },
      {
        predictionTimeSeconds: 60,
        minimumHorizontalSeparationNm: 3,
        ...config,
      },
    );

  // Dua pesawat 6 NM berpapasan di tengah (arah berlawanan, 200 kt): jarak di detik 60 sudah 3,3 NM lagi, tetapi di tengah jalan nol.
  const head = (id: string, lonOffsetNm: number, heading: number) => ({
    ...trackA,
    trackId: id,
    latitude: -7.385,
    longitude: 112.77 + lonOffsetNm / 60 / Math.cos((7.385 * Math.PI) / 180),
    groundSpeed: 200,
    heading,
  });

  test("tracks that cross paths and pass each other before the prediction time are still caught", () => {
    const [alert] = run([head("W", -3, 90), head("E", 3, 270)]);
    expect(alert).toBeDefined();
    expect(alert?.data.predictedTimeSeconds).toBe(54);
  });

  test("tracks that never come within the limit in the prediction time are not", () => {
    expect(run([head("W", -10, 90), head("E", 10, 270)])).toHaveLength(0);
  });

  test("a vertical gap exactly equal to the setting still counts as a conflict; one above it does not", () => {
    const low = { ...head("W", -3, 90), altitude: 3000 };
    expect(
      run([low, { ...head("E", 3, 270), altitude: 4000 }], {
        minimumVerticalSeparationFt: 1000,
      }),
    ).toHaveLength(1);
    expect(
      run([low, { ...head("E", 3, 270), altitude: 4001 }], {
        minimumVerticalSeparationFt: 1000,
      }),
    ).toHaveLength(0);
  });

  test("the surface STCA only takes targets reported on the ground", () => {
    const g = (id: string, lon: number, onGround: boolean | undefined) => ({
      ...trackA,
      trackId: id,
      altitude: 0,
      groundSpeed: 5,
      heading: 90,
      latitude: -7.385,
      longitude: lon,
      onGround,
    });
    const near = 112.77;
    const cfg = { includeSurface: true };
    expect(
      run([g("G1", near, true), g("G2", near + 0.0001, true)], cfg),
    ).toHaveLength(1);
    expect(
      run([g("G1", near, true), g("G2", near + 0.0001, undefined)], cfg),
    ).toHaveLength(0);
  });
});
