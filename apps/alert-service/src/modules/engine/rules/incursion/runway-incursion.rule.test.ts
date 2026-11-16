import { describe, expect, test } from "bun:test";
import { pushTrackHistory } from "../../track-history";
import type { AlertContext } from "../../types";
import { runwayIncursionRule } from "./runway-incursion.rule";

const now = new Date();

const activeRunway = {
  id: "RWY-09",
  active: true,
  polygon: [
    [-7.38, 112.76],
    [-7.38, 112.79],
    [-7.37, 112.79],
    [-7.37, 112.76],
  ] as [number, number][],
};

const inactiveRunway = {
  ...activeRunway,
  id: "RWY-09-INACTIVE",
  active: false,
};

const trackOccupant = {
  trackId: "T1",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.375,
  longitude: 112.775,
  timestamp: now,
};

const trackIntruder = {
  trackId: "T2",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.375,
  longitude: 112.775,
  timestamp: now,
};

const trackOutside = {
  trackId: "T3",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.42,
  longitude: 112.775,
  timestamp: now,
};

describe("runwayIncursionRule", () => {
  test("does not create an alert for a single track on an active runway", () => {
    pushTrackHistory(trackOccupant);
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOccupant],
    };
    const results = runwayIncursionRule.evaluate(ctx, {
      runways: [activeRunway],
    });

    expect(results.length).toBe(0);
  });

  test("creates an alert when a second track enters an active runway", () => {
    // T1 sudah berada di runway sejak titik sebelumnya.
    pushTrackHistory({
      ...trackOccupant,
      timestamp: new Date(now.getTime() - 2000),
    });
    pushTrackHistory(trackOccupant);
    // T2 baru masuk (titik sebelumnya tidak ada).
    pushTrackHistory(trackIntruder);

    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOccupant, trackIntruder],
    };
    const results = runwayIncursionRule.evaluate(ctx, {
      runways: [activeRunway],
    });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("RUNWAY_INCURSION");
    expect(results[0].trackId).toBe("T2");
    expect(results[0].relatedTrackId).toBe("T1");
    expect(results[0].data.runwayId).toBe("RWY-09");
    expect(results[0].data.relatedCallsign).toBe("T1");
  });

  test("does not create an alert for an inactive runway", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOccupant, trackIntruder],
    };
    const results = runwayIncursionRule.evaluate(ctx, {
      runways: [inactiveRunway],
    });

    expect(results.length).toBe(0);
  });

  test("does not create an alert for a track outside", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOutside],
    };
    const results = runwayIncursionRule.evaluate(ctx, {
      runways: [activeRunway],
    });

    expect(results.length).toBe(0);
  });
});

describe("runwayIncursionRule: severity", () => {
  const BASE_LON = 112.775;
  const M_PER_DEG_LON = 110_400;
  let seq = 0;
  const rw = (
    east: number,
    over: Partial<typeof trackOccupant> & {
      callsign?: string;
      groundSpeed?: number;
      onGround?: boolean;
    } = {},
  ) => ({
    ...trackOccupant,
    trackId: `SEV-${++seq}`,
    longitude: BASE_LON + east / M_PER_DEG_LON,
    groundSpeed: 0,
    onGround: true,
    ...over,
  });
  const evaluate = (
    tracks: ReturnType<typeof rw>[],
    config: Record<string, unknown> = {},
  ) =>
    runwayIncursionRule.evaluate(
      { airportId: "WARR", timestamp: now, tracks } as AlertContext,
      { runways: [activeRunway], ...config },
    );

  test("CRITICAL: two identified targets close together on an active runway", () => {
    const [alert] = evaluate([
      rw(0, { callsign: "GIA101" }),
      rw(200, { callsign: "BTK202" }),
    ]);
    expect(alert?.severity).toBe("CRITICAL");
    expect(alert?.confirmSeconds).toBe(3);
  });

  test("CRITICAL: one of them is on a take-off or landing roll, however far apart", () => {
    const [alert] = evaluate([
      rw(-700, { callsign: "GIA101", groundSpeed: 100 }),
      rw(800, { callsign: "VEH1" }),
    ]);
    expect(alert?.severity).toBe("CRITICAL");
  });

  test("WARNING: two identified targets that are slow and far apart", () => {
    const [alert] = evaluate([
      rw(-700, { callsign: "GIA101", groundSpeed: 5 }),
      rw(800, { callsign: "VEH1", groundSpeed: 8 }),
    ]);
    expect(alert?.severity).toBe("WARNING");
  });

  test("INFO, later, when one of the two has no identity", () => {
    const [alert] = evaluate([
      rw(0, { callsign: "GIA101" }),
      rw(150, { callsign: undefined }),
    ]);
    expect(alert?.severity).toBe("INFO");
    expect(alert?.confirmSeconds).toBe(15);
  });

  test("a single unidentified target alone on the runway is not reported by default", () => {
    expect(evaluate([rw(0, { callsign: undefined })])).toHaveLength(0);
  });

  test("... unless reportUnidentifiedAlone is on: INFO after 10 s, with no occupant", () => {
    const [alert] = evaluate([rw(0, { callsign: undefined })], {
      reportUnidentifiedAlone: true,
    });
    expect(alert?.severity).toBe("INFO");
    expect(alert?.confirmSeconds).toBe(10);
    expect(alert?.relatedTrackId).toBeUndefined();
  });

  test("a single identified target alone is never an incursion", () => {
    expect(
      evaluate([rw(0, { callsign: "GIA101" })], {
        reportUnidentifiedAlone: true,
      }),
    ).toHaveLength(0);
  });

  test("the thresholds can be set in the rule configuration", () => {
    const [alert] = evaluate(
      [rw(0, { callsign: "GIA101" }), rw(200, { callsign: "BTK202" })],
      { criticalSeparationMeters: 100 },
    );
    expect(alert?.severity).toBe("WARNING");
  });

  test("an airborne target over the runway is not on it", () => {
    expect(
      evaluate([
        rw(0, { callsign: "GIA101" }),
        rw(100, { callsign: "BTK202", onGround: false }),
      ]),
    ).toHaveLength(0);
  });
});
