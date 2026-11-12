import { describe, expect, test } from "bun:test";
import type { AlertContext, MovementTrack } from "../../types";
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
    expect(results[0].data.domain).toBe("AIR");
    expect(results[0].data.category).toBe("AIR_HIGH");
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
      expect(results[0].data.category).toBe("SURFACE");
      expect(
        (results[0].data.zone as { radiusM: number | null }).radiusM,
      ).toBeNull();
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
      expect(air[0].data.category).toBe("AIR_HIGH");
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

describe("STCA air and surface categories", () => {
  const WARR_AREA = {
    centerLatitude: -7.3797,
    centerLongitude: 112.7868,
    groundRadiusM: 5000,
    airRadiusM: 15 * 1852,
    airCeilingM: 10000 * 0.3048,
  };
  const metersToLat = (m: number) => m / 111_320;
  const metersToLon = (m: number) =>
    m / (111_320 * Math.cos((WARR_AREA.centerLatitude * Math.PI) / 180));
  const at = (
    northM: number,
    eastM: number,
    over: Partial<MovementTrack> = {},
  ): MovementTrack => ({
    ...trackA,
    latitude: WARR_AREA.centerLatitude + metersToLat(northM),
    longitude: WARR_AREA.centerLongitude + metersToLon(eastM),
    onGround: false,
    ...over,
  });
  const cfg = {
    predictionTimeSeconds: 60,
    minimumHorizontalSeparationNm: 3,
  };
  const run = (
    tracks: MovementTrack[],
    config: Record<string, unknown> = cfg,
  ) =>
    stcaRule.evaluate(
      { airportId: "WARR", timestamp: now, tracks, alertArea: WARR_AREA },
      config,
    );

  test("AIR_LOW_DOME: two aircraft below 1000 ft, within 2.5 km, current 2D distance ≤ 140 m", () => {
    const a = at(0, 0, {
      trackId: "D1",
      altitude: 400,
      groundSpeed: 30,
      heading: 90,
      callsign: "DOME1",
    });
    const b = at(0, 100, {
      trackId: "D2",
      altitude: 400,
      groundSpeed: 30,
      heading: 270,
      callsign: "DOME2",
    });
    const results = run([a, b]);
    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_LOW_DOME");
    expect(results[0].data.domain).toBe("AIR");
    expect(results[0].data.predictedTimeSeconds).toBeNull();
    expect(results[0].data.horizontalSeparationMeters).toBeLessThanOrEqual(140);
    expect(results[0].data.minimumSeparationMeters).toBe(140);
    expect(
      (results[0].data.zone as { altitudeFt: number; radiusM: number })
        .altitudeFt,
    ).toBe(400);
    expect((results[0].data.zone as { radiusM: number }).radiusM).toBe(2500);
  });

  test("400 ft / 30 kt stays in the air, not SURFACE", () => {
    const a = at(0, 0, {
      trackId: "L1",
      altitude: 400,
      groundSpeed: 30,
      heading: 0,
      callsign: "LOW1",
    });
    const b = at(0, 100, {
      trackId: "L2",
      altitude: 400,
      groundSpeed: 30,
      heading: 180,
      callsign: "LOW2",
    });
    const withSurface = run([a, b], { ...cfg, includeSurface: true });
    expect(withSurface.map((r) => r.data.category)).toEqual(["AIR_LOW_DOME"]);
  });

  test("AIR_LOW_CROSSING: both below 1500 ft inside 5 km, predicted < 500 m, not the 140 m dome", () => {
    const a = at(0, 0, {
      trackId: "C1",
      altitude: 980,
      groundSpeed: 0,
      heading: 90,
      callsign: "X1",
    });
    const b = at(0, 200, {
      trackId: "C2",
      altitude: 980,
      groundSpeed: 0,
      heading: 270,
      callsign: "X2",
    });
    const results = run([a, b]);
    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_LOW_CROSSING");
    expect(results[0].data.horizontalSeparationMeters).toBeGreaterThan(140);
    expect(results[0].data.horizontalSeparationMeters).toBeLessThan(500);
    expect(results[0].data.predictedTimeSeconds).toBe(60);
  });

  test("1200 ft at 100 m is crossing, not dome (dome needs < 1000 ft)", () => {
    const a = at(0, 0, { trackId: "H1", altitude: 1200, groundSpeed: 0 });
    const b = at(0, 100, { trackId: "H2", altitude: 1200, groundSpeed: 0 });
    expect(run([a, b])[0]?.data.category).toBe("AIR_LOW_CROSSING");
  });

  test("mixed 1600 ft and 900 ft uses AIR_HIGH parameters", () => {
    const a = at(0, 0, { trackId: "HI", altitude: 1600, groundSpeed: 80 });
    const b = at(0, 100, { trackId: "LO", altitude: 900, groundSpeed: 80 });
    const results = run([a, b]);
    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_HIGH");
    expect(results[0].data.minimumHorizontalSeparationNm).toBe(3);
  });

  test("two aircraft at 800 ft 1 km apart inside the low band do not fall back to 3 NM", () => {
    const a = at(0, 0, { trackId: "F1", altitude: 800, groundSpeed: 0 });
    const b = at(0, 1000, { trackId: "F2", altitude: 800, groundSpeed: 0 });
    expect(run([a, b]).length).toBe(0);
  });

  test("without ALERT_AREA, the same 800 ft / 1 km pair is AIR_HIGH (category 2/3 have no zone)", () => {
    const a = at(0, 0, { trackId: "F1", altitude: 800, groundSpeed: 0 });
    const b = at(0, 1000, { trackId: "F2", altitude: 800, groundSpeed: 0 });
    const results = stcaRule.evaluate(
      { airportId: "WARR", timestamp: now, tracks: [a, b] },
      cfg,
    );
    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_HIGH");
  });

  test("vertical gap above 100 m blocks AIR_LOW_CROSSING", () => {
    const a = at(0, 0, { trackId: "V1", altitude: 980, groundSpeed: 0 });
    const b = at(0, 200, { trackId: "V2", altitude: 1380, groundSpeed: 0 });
    expect(run([a, b]).length).toBe(0);
  });
  test("exactly 1500 ft, parallel 300 m: AIR_HIGH; 1499 ft: AIR_LOW_CROSSING", () => {
    const mk = (alt: number) => [
      at(0, 3300, {
        trackId: "B1",
        altitude: alt,
        groundSpeed: 30,
        heading: 90,
      }),
      at(-300, 3300, {
        trackId: "B2",
        altitude: alt,
        groundSpeed: 30,
        heading: 90,
      }),
    ];
    expect(run(mk(1500))[0]?.data.category).toBe("AIR_HIGH");
    expect(run(mk(1499))[0]?.data.category).toBe("AIR_LOW_CROSSING");
  });

  test("400 ft pair outside the 5 km ground zone falls to AIR_HIGH parameters", () => {
    const a = at(0, 5500, {
      trackId: "O1",
      altitude: 400,
      groundSpeed: 30,
      heading: 90,
    });
    const b = at(-300, 5500, {
      trackId: "O2",
      altitude: 400,
      groundSpeed: 30,
      heading: 90,
    });
    expect(run([a, b])[0]?.data.category).toBe("AIR_HIGH");
  });

  test("sampling at t+60: paths meeting at t+60 alert, paths that cross at t+30 do not", () => {
    // meet at t+60: 60 kt, 1852 m from the meeting point
    const meet60 = [
      at(0, 3308 - 1852, {
        trackId: "M1",
        altitude: 400,
        groundSpeed: 60,
        heading: 90,
      }),
      at(-1852, 3308, {
        trackId: "M2",
        altitude: 400,
        groundSpeed: 60,
        heading: 0,
      }),
    ];
    expect(run(meet60)[0]?.data.category).toBe("AIR_LOW_CROSSING");
    // meet at t+30 (documents the current limitation)
    const meet30 = [
      at(0, 3308 - 926, {
        trackId: "N1",
        altitude: 400,
        groundSpeed: 60,
        heading: 90,
      }),
      at(-926, 3308, {
        trackId: "N2",
        altitude: 400,
        groundSpeed: 60,
        heading: 0,
      }),
    ];
    expect(run(meet30).length).toBe(0);
  });

  test("dome: 999 ft in, 1000 ft out; 139 m in, 141 m out", () => {
    const pair = (alt: number, gapM: number) => [
      at(0, 0, { trackId: "K1", altitude: alt, groundSpeed: 30, heading: 90 }),
      at(0, gapM, {
        trackId: "K2",
        altitude: alt,
        groundSpeed: 30,
        heading: 270,
      }),
    ];
    expect(run(pair(999, 100))[0]?.data.category).toBe("AIR_LOW_DOME");
    expect(run(pair(1000, 100))[0]?.data.category).not.toBe("AIR_LOW_DOME");
    expect(run(pair(400, 139))[0]?.data.category).toBe("AIR_LOW_DOME");
    expect(run(pair(400, 141))[0]?.data.category).not.toBe("AIR_LOW_DOME");
  });
});
