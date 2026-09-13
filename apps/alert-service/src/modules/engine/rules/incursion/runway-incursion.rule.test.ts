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
