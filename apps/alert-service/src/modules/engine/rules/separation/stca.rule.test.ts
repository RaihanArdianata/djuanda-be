import { describe, expect, test } from "bun:test";
import type { AlertContext, MovementTrack } from "../../types";
import { calculateCpa, predict, stcaRule } from "./stca.rule";

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
      altitude: 2000,
    };
    const trackLower = {
      ...trackB,
      trackId: "BL",
      altitude: 2500,
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
      // 1200 ft: airborne (>500 ft and >1000 ft), so the pair is evaluated and (0.9 NM ≈ 1666 m apart <= 3000 m) alerts in AIR_MID.
      expect(
        run([
          unflagged("U1", 1200),
          {
            ...unflagged("U2", 1200),
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

  // Uji penerimaan kriteria baru (draft §5)
  test("1. Dua pesawat 1.600 ft, pemisahan 4 km -> alert AIR_HIGH", () => {
    const a = at(0, 0, { trackId: "H1", altitude: 1600, groundSpeed: 0 });
    const b = at(0, 4000, { trackId: "H2", altitude: 1600, groundSpeed: 0 });
    const results = run([a, b]);
    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_HIGH");
    expect(results[0].data.domain).toBe("AIR");
  });

  test("2. Dua pesawat di atas plafon kubah -> tidak ada alert pita HIGH", () => {
    // plafon WARR_AREA = 10000 ft
    const a = at(0, 0, { trackId: "C1", altitude: 10500, groundSpeed: 0 });
    const b = at(0, 2000, { trackId: "C2", altitude: 10500, groundSpeed: 0 });
    const results = run([a, b]);
    expect(results.length).toBe(0);
  });

  test("3. Dua pesawat 1.400 ft, pemisahan 40 m -> alert AIR_CLOSE", () => {
    const a = at(0, 0, { trackId: "CL1", altitude: 1400, groundSpeed: 0 });
    const b = at(0, 40, { trackId: "CL2", altitude: 1400, groundSpeed: 0 });
    const results = run([a, b]);
    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_CLOSE");
    expect(results[0].data.domain).toBe("AIR");
    expect(results[0].data.predictedTimeSeconds).toBeNull();
    expect(results[0].data.horizontalSeparationMeters).toBeCloseTo(40, 0);
  });

  test("4. Dua pesawat 1.400 ft, pemisahan 2 km, keduanya di bawah 1.500 ft tapi di atas 1.000 ft -> alert AIR_MID", () => {
    const a = at(0, 0, { trackId: "M1", altitude: 1400, groundSpeed: 0 });
    const b = at(0, 2000, { trackId: "M2", altitude: 1400, groundSpeed: 0 });
    const results = run([a, b]);
    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_MID");
    expect(results[0].data.domain).toBe("AIR");
    expect(results[0].data.predictedTimeSeconds).toBe(60);
    expect(results[0].data.horizontalSeparationMeters).toBeCloseTo(2000, -1);
  });

  test("5. Pasangan 1.600 ft pada pemisahan 40 m -> satu alert saja (AIR_CLOSE, tidak dobel AIR_HIGH)", () => {
    const a = at(0, 0, { trackId: "T1", altitude: 1600, groundSpeed: 0 });
    const b = at(0, 40, { trackId: "T2", altitude: 1600, groundSpeed: 0 });
    const results = run([a, b]);
    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_CLOSE");
    expect(results[0].data.domain).toBe("AIR");
  });

  test("6. Satu track tanpa ketinggian + requireAltitude default -> tidak ikut", () => {
    const a = at(0, 0, { trackId: "A1", altitude: undefined, groundSpeed: 0 });
    const b = at(0, 40, { trackId: "A2", altitude: 1400, groundSpeed: 0 });
    const results = run([a, b]);
    expect(results.length).toBe(0);
  });

  test("AIR_CLOSE: batas pemisahan 50 m (49 m alert, 51 m no alert untuk < 1000 ft)", () => {
    const mk = (gapM: number) => [
      at(0, 0, { trackId: "K1", altitude: 800, groundSpeed: 0 }),
      at(0, gapM, { trackId: "K2", altitude: 800, groundSpeed: 0 }),
    ];
    expect(run(mk(49)).length).toBe(1);
    expect(run(mk(49))[0]?.data.category).toBe("AIR_CLOSE");
    expect(run(mk(51)).length).toBe(0);
  });

  test("AIR_MID: rentang ketinggian > 1000 ft dan < 1500 ft, jarak <= 3000 m", () => {
    // 1000 ft pas: di luar kriteria > 1000 ft
    const at1000 = [
      at(0, 0, { trackId: "P1", altitude: 1000, groundSpeed: 0 }),
      at(0, 2000, { trackId: "P2", altitude: 1000, groundSpeed: 0 }),
    ];
    expect(run(at1000).length).toBe(0);

    // 1001 ft: masuk AIR_MID
    const at1001 = [
      at(0, 0, { trackId: "P1", altitude: 1001, groundSpeed: 0 }),
      at(0, 2000, { trackId: "P2", altitude: 1001, groundSpeed: 0 }),
    ];
    expect(run(at1001)[0]?.data.category).toBe("AIR_MID");

    // 3000 m: masuk AIR_MID
    const at3000m = [
      at(0, 0, { trackId: "P1", altitude: 1400, groundSpeed: 0 }),
      at(0, 3000, { trackId: "P2", altitude: 1400, groundSpeed: 0 }),
    ];
    expect(run(at3000m)[0]?.data.category).toBe("AIR_MID");

    // 3010 m (sebenarnya > 3000 m geodesik): di luar batas MID
    const at3010m = [
      at(0, 0, { trackId: "P1", altitude: 1400, groundSpeed: 0 }),
      at(0, 3010, { trackId: "P2", altitude: 1400, groundSpeed: 0 }),
    ];
    expect(run(at3010m).length).toBe(0);
  });

  test("400 ft / 30 kt pada jarak 40 m masuk AIR_CLOSE, bukan SURFACE", () => {
    const a = at(0, 0, {
      trackId: "L1",
      altitude: 400,
      groundSpeed: 30,
      heading: 0,
      callsign: "LOW1",
    });
    const b = at(0, 40, {
      trackId: "L2",
      altitude: 400,
      groundSpeed: 30,
      heading: 180,
      callsign: "LOW2",
    });
    const withSurface = run([a, b], { ...cfg, includeSurface: true });
    expect(withSurface.map((r) => r.data.category)).toEqual(["AIR_CLOSE"]);
  });

  test("AIR_HIGH: batas ketinggian >= 1500 ft", () => {
    const mk = (alt: number) => [
      at(0, 0, { trackId: "B1", altitude: alt, groundSpeed: 0 }),
      at(0, 4000, { trackId: "B2", altitude: alt, groundSpeed: 0 }),
    ];
    expect(run(mk(1500))[0]?.data.category).toBe("AIR_HIGH");
    expect(run(mk(1499)).length).toBe(0);
  });
});

describe("predict 3D track pergerakan pesawat (Task 4)", () => {
  test("memperhitungkan latitude, longitude, heading, dan groundSpeed dalam rentang 60s", () => {
    // 120 knots selama 60 detik = 2 NM
    const t: MovementTrack = {
      ...trackA,
      latitude: -7.385,
      longitude: 112.77,
      groundSpeed: 120,
      heading: 90, // East
      altitude: 3000,
    };
    const p = predict(t, 60);
    // perpindahan ke timur ~ 2 NM (112.77 -> ~112.803)
    expect(p.latitude).toBeCloseTo(-7.385, 3);
    expect(p.longitude).toBeGreaterThan(112.77);
    expect(p.altitude).toBe(3000);
  });

  test("memperhitungkan proyeksi altitude dengan verticalRate positif (climb)", () => {
    const climbing: MovementTrack = {
      ...trackA,
      altitude: 2000,
      verticalRate: 1200, // 1200 ft/min
    };
    // Dalam 60 detik bertambah 1200 ft -> 3200 ft
    const p60 = predict(climbing, 60);
    expect(p60.altitude).toBe(3200);

    // Dalam 30 detik bertambah 600 ft -> 2600 ft
    const p30 = predict(climbing, 30);
    expect(p30.altitude).toBe(2600);
  });

  test("memperhitungkan proyeksi altitude dengan verticalRate negatif (descent)", () => {
    const descending: MovementTrack = {
      ...trackA,
      altitude: 3000,
      verticalRate: -1500, // -1500 ft/min
    };
    // Dalam 60 detik berkurang 1500 ft -> 1500 ft
    const p = predict(descending, 60);
    expect(p.altitude).toBe(1500);
  });

  test("proyeksi altitude tidak tembus di bawah permukaan tanah (minimum 0 ft)", () => {
    const plunge: MovementTrack = {
      ...trackA,
      altitude: 500,
      verticalRate: -3000,
    };
    const p = predict(plunge, 60);
    expect(p.altitude).toBe(0);
  });

  test("evaluasi STCA memperhitungkan predictedVerticalSeparationFt saat pesawat climbing", () => {
    // Pesawat A di 2000 ft, climb 1200 ft/min -> t+60s diprediksi di 3200 ft
    // Pesawat B di 3200 ft, level flight -> t+60s di 3200 ft
    // Pada t=0, selisih 1200 ft (di luar batas 1000 ft). Pada t+60, selisih 0 ft (konflik vertikal!).
    const planeA = {
      ...trackA,
      trackId: "CLIMB_A",
      altitude: 2000,
      verticalRate: 1200,
      groundSpeed: 60,
      heading: 270,
    };
    const planeB = {
      ...trackB,
      trackId: "LEVEL_B",
      altitude: 3200,
      verticalRate: 0,
      groundSpeed: 60,
      heading: 90,
    };

    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [planeA, planeB],
    };

    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
      minimumVerticalSeparationFt: 1000,
    });

    expect(results.length).toBe(1);
    expect(results[0].data.predictedVerticalSeparationFt).toBeLessThanOrEqual(
      20,
    );
    expect(results[0].data.predictedTimeSeconds).toBeGreaterThanOrEqual(58);
    expect(results[0].data.predictedTimeSeconds).toBeLessThanOrEqual(60);
  });

  test("evaluasi STCA tidak memicu alert bila pesawat climb menjauhi batas vertikal", () => {
    // Pesawat A di 3000 ft, climb 2000 ft/min -> t+60s di 5000 ft
    // Pesawat B di 3500 ft, level flight -> t+60s di 3500 ft
    // Pada t=0 selisih 500 ft (< 1000 ft), tapi pada t+60s selisih 1500 ft (>= 1000 ft).
    const planeA = {
      ...trackA,
      trackId: "SEPARATE_A",
      altitude: 3000,
      verticalRate: 2000,
      groundSpeed: 60,
      heading: 270,
    };
    const planeB = {
      ...trackB,
      trackId: "LEVEL_B",
      altitude: 3500,
      verticalRate: 0,
      groundSpeed: 60,
      heading: 90,
    };

    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [planeA, planeB],
    };

    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
      minimumVerticalSeparationFt: 1000,
    });

    expect(results.length).toBe(0);
  });
});

describe("deteksi potensi perpotongan jalur pergerakan pesawat CPA (Task 5)", () => {
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

  test("calculateCpa menghitung waktu t_cpa dan jarak minimum pada jalur bersilangan", () => {
    // Pesawat A di barat menuju timur, Pesawat B di selatan menuju utara
    // Keduanya bertemu di titik tengah (0, 0) pada t = 30 detik
    // speed 60 kt = 1852 m / 60s -> dalam 30s menempuh 926 m
    const planeA: MovementTrack = {
      ...trackA,
      trackId: "CROSS_A",
      latitude: WARR_AREA.centerLatitude,
      longitude: WARR_AREA.centerLongitude - metersToLon(926),
      groundSpeed: 60,
      heading: 90, // East
      altitude: 2000,
    };
    const planeB: MovementTrack = {
      ...trackB,
      trackId: "CROSS_B",
      latitude: WARR_AREA.centerLatitude - metersToLat(926),
      longitude: WARR_AREA.centerLongitude,
      groundSpeed: 60,
      heading: 0, // North
      altitude: 2000,
    };

    const cpa = calculateCpa(planeA, planeB, 60);
    expect(cpa.converging).toBe(true);
    expect(cpa.timeToCpaSeconds).toBeGreaterThanOrEqual(29);
    expect(cpa.timeToCpaSeconds).toBeLessThanOrEqual(31);
    expect(cpa.minSeparationMeters).toBeLessThan(50);
  });

  test("mendeteksi perpotongan jalur di t = 30s yang pada t = 60s sudah saling menjauh", () => {
    // Pada t = 0: terpisah ~1310 m
    // Pada t = 30s: saling berpotongan (jarak ~0 m)
    // Pada t = 60s: saling menjauh kembali hingga terpisah ~1310 m (atau lebih jauh bila kecepatan tinggi)
    // Diuji dengan limit jarak pemisahan ketat misal 200 m (AIR_CLOSE / MID)
    const planeA: MovementTrack = {
      ...trackA,
      trackId: "X_WEST",
      latitude: WARR_AREA.centerLatitude,
      longitude: WARR_AREA.centerLongitude - metersToLon(926),
      groundSpeed: 60,
      heading: 90,
      altitude: 1400,
    };
    const planeB: MovementTrack = {
      ...trackB,
      trackId: "X_SOUTH",
      latitude: WARR_AREA.centerLatitude - metersToLat(926),
      longitude: WARR_AREA.centerLongitude,
      groundSpeed: 60,
      heading: 0,
      altitude: 1400,
    };

    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [planeA, planeB],
      alertArea: WARR_AREA,
    };

    // Dengan batas 3000 m (AIR_MID), CPA terdeteksi dan membawa waktu prediksi ~30s
    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      midSeparationMeters: 3000,
      midAltitudeFt: 1000,
      minAltitudeFt: 1500,
    });

    expect(results.length).toBe(1);
    expect(results[0].data.category).toBe("AIR_MID");
    expect(results[0].data.predictedTimeSeconds).toBeGreaterThanOrEqual(28);
    expect(results[0].data.predictedTimeSeconds).toBeLessThanOrEqual(32);
    expect(results[0].data.horizontalSeparationMeters).toBeLessThan(100);
  });

  test("jalur yang saling membelakangi / menjauh (diverging) tidak memicu alert", () => {
    // Pesawat A di (0,0) bergerak ke barat, Pesawat B di (0, 1000m) bergerak ke timur
    const planeA: MovementTrack = {
      ...trackA,
      trackId: "DIV_A",
      latitude: WARR_AREA.centerLatitude,
      longitude: WARR_AREA.centerLongitude,
      groundSpeed: 60,
      heading: 270, // West
      altitude: 3000,
    };
    const planeB: MovementTrack = {
      ...trackB,
      trackId: "DIV_B",
      latitude: WARR_AREA.centerLatitude,
      longitude: WARR_AREA.centerLongitude + metersToLon(4000),
      groundSpeed: 60,
      heading: 90, // East
      altitude: 3000,
    };

    const cpa = calculateCpa(planeA, planeB, 60);
    expect(cpa.converging).toBe(false);
    expect(cpa.timeToCpaSeconds).toBe(0);

    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [planeA, planeB],
      alertArea: WARR_AREA,
    };

    // Jarak awal 4000 m, jika diverging dan batas 3 NM (5556 m), tidak boleh ada alert karena saling menjauh
    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      highSeparationMeters: 3500,
    });

    expect(results.length).toBe(0);
  });

  test("perpotongan jalur di luar batas horizon waktu (misal t = 120s) tidak memicu alert", () => {
    // Pesawat terpisah sangat jauh (misal 10 km) sehingga pertemuan baru terjadi 120s lagi
    const planeA: MovementTrack = {
      ...trackA,
      trackId: "FAR_A",
      latitude: WARR_AREA.centerLatitude,
      longitude: WARR_AREA.centerLongitude - metersToLon(4000),
      groundSpeed: 40,
      heading: 90,
      altitude: 3000,
    };
    const planeB: MovementTrack = {
      ...trackB,
      trackId: "FAR_B",
      latitude: WARR_AREA.centerLatitude - metersToLat(4000),
      longitude: WARR_AREA.centerLongitude,
      groundSpeed: 40,
      heading: 0,
      altitude: 3000,
    };

    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [planeA, planeB],
      alertArea: WARR_AREA,
    };

    const results = stcaRule.evaluate(ctx, {
      predictionTimeSeconds: 60,
      highSeparationMeters: 1000, // batas sempit 1000 m
    });

    expect(results.length).toBe(0);
  });
});
