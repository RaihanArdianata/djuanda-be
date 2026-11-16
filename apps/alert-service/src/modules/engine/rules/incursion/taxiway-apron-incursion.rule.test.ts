import { describe, expect, test } from "bun:test";
import type { AlertContext, MovementTrack } from "../../types";
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

const BASE_LAT = -7.375;
const BASE_LON = 112.775;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = 110_400;

/** Target `east` meter ke timur dan `north` meter ke utara dari titik acuan di dalam permukaan. */
const ac = (
  id: string,
  east: number,
  north: number,
  over: Partial<MovementTrack> = {},
): MovementTrack => ({
  trackId: id,
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: BASE_LAT + north / M_PER_DEG_LAT,
  longitude: BASE_LON + east / M_PER_DEG_LON,
  groundSpeed: 0,
  heading: 90,
  onGround: true,
  callsign: id,
  timestamp: now,
  ...over,
});

const evaluate = (
  tracks: MovementTrack[],
  config: Record<string, unknown> = {},
  type: "TAXIWAY" | "APRON" = "TAXIWAY",
  status = "ACTIVE",
) => {
  const ctx: AlertContext = { airportId: "WARR", timestamp: now, tracks };
  return taxiwayApronIncursionRule.evaluate(ctx, {
    surfaces: [{ ...surface, type, status }],
    ...config,
  });
};

const expectedRoute: [number, number][] = [
  [-7.385, 112.77],
  [-7.385, 112.78],
];

describe("taxiwayApronIncursionRule: presence alone is not an alert", () => {
  test("a lone track on a normal ACTIVE surface", () => {
    expect(evaluate([ac("T1", 0, 0)])).toHaveLength(0);
  });

  test("two aircraft parked side by side on an apron, 30 m apart", () => {
    expect(evaluate([ac("A", 0, 0), ac("B", 30, 0)], {}, "APRON")).toHaveLength(
      0,
    );
  });

  test("two aircraft standing in a queue on a taxiway", () => {
    expect(evaluate([ac("A", 0, 0), ac("B", 60, 0)])).toHaveLength(0);
  });

  test("an aircraft following another at the same speed (not closing)", () => {
    const moving = { groundSpeed: 12, heading: 90 };
    expect(
      evaluate([ac("A", 0, 0, moving), ac("B", 60, 0, moving)]),
    ).toHaveLength(0);
  });

  test("two aircraft moving apart", () => {
    const a = ac("A", 0, 0, { groundSpeed: 12, heading: 270 });
    const b = ac("B", 50, 0, { groundSpeed: 12, heading: 90 });
    expect(evaluate([a, b])).toHaveLength(0);
  });

  test("a track outside the surface", () => {
    expect(evaluate([ac("T2", 0, 5_000)])).toHaveLength(0);
  });
});

describe("taxiwayApronIncursionRule: closing targets", () => {
  test("CRITICAL: a moving aircraft on a collision course with one standing 70 m ahead", () => {
    const [alert] = evaluate([
      ac("A", 0, 0, { groundSpeed: 10, heading: 90 }),
      ac("B", 70, 0),
    ]);
    expect(alert?.severity).toBe("CRITICAL");
    expect(alert?.trackId).toBe("A");
    expect(alert?.relatedTrackId).toBe("B");
    expect(alert?.confirmSeconds).toBe(3);
    expect(alert?.data.reason).toBe("CLOSING");
  });

  test("WARNING: closing within 80 m but passing 30 m clear of each other", () => {
    const [alert] = evaluate([
      ac("A", 0, 30, { groundSpeed: 10, heading: 90 }),
      ac("B", 70, 0),
    ]);
    expect(alert?.severity).toBe("WARNING");
  });

  test("nothing beyond the warning distance, even when closing", () => {
    expect(
      evaluate([
        ac("A", 0, 0, { groundSpeed: 10, heading: 90 }),
        ac("B", 200, 0),
      ]),
    ).toHaveLength(0);
  });

  test("an apron uses its own, shorter warning distance", () => {
    const tracks = [
      ac("A", 0, 30, { groundSpeed: 10, heading: 90 }),
      ac("B", 60, 0),
    ];
    // 67 m apart: inside the taxiway distance (80 m) but outside the apron distance (40 m).
    expect(evaluate(tracks, {}, "TAXIWAY")).toHaveLength(1);
    expect(evaluate(tracks, {}, "APRON")).toHaveLength(0);
  });

  test("INFO, not CRITICAL, when one of them has no identity (it may be a sensor echo)", () => {
    const [alert] = evaluate([
      ac("A", 0, 0, { groundSpeed: 10, heading: 90 }),
      ac("B", 70, 0, { callsign: undefined }),
    ]);
    expect(alert?.severity).toBe("INFO");
    expect(alert?.confirmSeconds).toBe(15);
  });

  test("the faster one is the intruder, the other the occupant", () => {
    const [alert] = evaluate([
      ac("SLOW", 0, 0, { groundSpeed: 4, heading: 90 }),
      ac("FAST", 50, 0, { groundSpeed: 12, heading: 270 }),
    ]);
    expect(alert?.trackId).toBe("FAST");
    expect(alert?.relatedTrackId).toBe("SLOW");
  });

  test("the old taxiwayProximityMeters setting still sets the warning distance", () => {
    const tracks = [
      ac("A", 0, 30, { groundSpeed: 10, heading: 90 }),
      ac("B", 110, 0),
    ];
    // 114 m apart: beyond the default 80 m, inside a configured 150 m.
    expect(evaluate(tracks)).toHaveLength(0);
    expect(evaluate(tracks, { taxiwayProximityMeters: 150 }).length).toBe(1);
  });

  test("thresholds can be set in the rule configuration", () => {
    const tracks = [
      ac("A", 0, 0, { groundSpeed: 10, heading: 90 }),
      ac("B", 70, 0),
    ];
    // Critical only inside 5 m: this collision course passes within about 9 m, so it is a warning.
    const [alert] = evaluate(tracks, { criticalSeparationMeters: 5 });
    expect(alert?.severity).toBe("WARNING");
  });
});

describe("taxiwayApronIncursionRule: restricted surfaces", () => {
  test("WARNING for an identified track on a RESTRICTED surface", () => {
    const [alert] = evaluate([ac("T1", 0, 0)], {}, "TAXIWAY", "RESTRICTED");
    expect(alert?.severity).toBe("WARNING");
    expect(alert?.confirmSeconds).toBe(5);
    expect(alert?.data.reason).toBe("RESTRICTED_ENTRY");
  });

  test("WARNING for an identified track on an INACTIVE surface", () => {
    const [alert] = evaluate([ac("T1", 0, 0)], {}, "TAXIWAY", "INACTIVE");
    expect(alert?.severity).toBe("WARNING");
  });

  test("INFO, later, for a track with no identity", () => {
    const [alert] = evaluate(
      [ac("T1", 0, 0, { callsign: undefined })],
      {},
      "TAXIWAY",
      "RESTRICTED",
    );
    expect(alert?.severity).toBe("INFO");
    expect(alert?.confirmSeconds).toBe(15);
  });

  test("one alert per track even when it also closes on another aircraft: the higher severity wins", () => {
    const alerts = evaluate(
      [ac("A", 0, 0, { groundSpeed: 10, heading: 90 }), ac("B", 70, 0)],
      {},
      "TAXIWAY",
      "RESTRICTED",
    );
    const forA = alerts.filter((a) => a.trackId === "A");
    expect(forA).toHaveLength(1);
    expect(forA[0]?.severity).toBe("CRITICAL");
  });

  test("a track right on the edge is not counted as inside", () => {
    // About 1 m inside the northern edge: within the 3 m margin that absorbs position jitter.
    const edge = ac("EDGE", 0, 0, { latitude: -7.37 - 1 / M_PER_DEG_LAT });
    expect(evaluate([edge], {}, "TAXIWAY", "RESTRICTED")).toHaveLength(0);
    const inside = ac("IN", 0, 0, { latitude: -7.37 - 10 / M_PER_DEG_LAT });
    expect(evaluate([inside], {}, "TAXIWAY", "RESTRICTED")).toHaveLength(1);
  });
});

describe("taxiwayApronIncursionRule: expected route", () => {
  test("WARNING when an identified track is off the expected route", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [ac("T3", 0, 0, { latitude: -7.39, longitude: 112.78 })],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 50,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.data.reason).toBe("OFF_ROUTE");
    expect(results[0]?.severity).toBe("WARNING");
    expect(results[0]?.confirmSeconds).toBe(10);
  });

  test("INFO when the track has no identity", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [
        ac("T3", 0, 0, {
          latitude: -7.39,
          longitude: 112.78,
          callsign: undefined,
        }),
      ],
    };
    const results = taxiwayApronIncursionRule.evaluate(ctx, {
      expectedRoute,
      maxDistanceMeters: 50,
    });
    expect(results[0]?.severity).toBe("INFO");
  });

  test("no alert when the track is on the expected route", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [ac("T4", 0, 0, { latitude: -7.385, longitude: 112.775 })],
    };
    expect(
      taxiwayApronIncursionRule.evaluate(ctx, {
        expectedRoute,
        maxDistanceMeters: 50,
      }),
    ).toHaveLength(0);
  });
});
