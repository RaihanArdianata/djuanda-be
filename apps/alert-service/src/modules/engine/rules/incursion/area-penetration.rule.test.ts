import { describe, expect, test } from "bun:test";
import type { AlertContext } from "../../types";
import { areaPenetrationRule } from "./area-penetration.rule";

const now = new Date();

const trackInside = {
  trackId: "T1",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.39,
  longitude: 112.785,
  timestamp: now,
};

const trackOutside = {
  trackId: "T2",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.41,
  longitude: 112.785,
  timestamp: now,
};

const area = {
  id: "RESTRICTED-1",
  type: "RESTRICTED",
  polygon: [
    [-7.4, 112.77],
    [-7.4, 112.8],
    [-7.38, 112.8],
    [-7.38, 112.77],
  ] as [number, number][],
};

describe("areaPenetrationRule", () => {
  test("creates an alert for a track inside a restricted area", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackInside],
    };
    const results = areaPenetrationRule.evaluate(ctx, { areas: [area] });

    expect(results.length).toBe(1);
    expect(results[0].type).toBe("AREA_PENETRATION");
    expect(results[0].trackId).toBe("T1");
    expect(results[0].data.areaId).toBe("RESTRICTED-1");
  });
  test("does not create an alert for a track outside the area", () => {
    const ctx: AlertContext = {
      airportId: "WARR",
      timestamp: now,
      tracks: [trackOutside],
    };
    const results = areaPenetrationRule.evaluate(ctx, { areas: [area] });

    expect(results.length).toBe(0);
  });
});

describe("areaPenetrationRule: severity", () => {
  let seq = 0;
  const at = (over: Record<string, unknown> = {}) => ({
    ...trackInside,
    trackId: `AP-${++seq}`,
    callsign: "GIA101",
    groundSpeed: 0,
    onGround: true,
    ...over,
  });
  const evaluate = (
    tracks: ReturnType<typeof at>[],
    over: Record<string, unknown> = {},
    config: Record<string, unknown> = {},
  ) =>
    areaPenetrationRule.evaluate(
      { airportId: "WARR", timestamp: now, tracks } as AlertContext,
      { areas: [{ ...area, ...over }], ...config },
    );

  test("WARNING for an identified target in a restricted area, after 5 s", () => {
    const [alert] = evaluate([at()]);
    expect(alert?.severity).toBe("WARNING");
    expect(alert?.confirmSeconds).toBe(5);
  });

  test("INFO, after 15 s, for a target with no identity", () => {
    const [alert] = evaluate([at({ callsign: undefined })]);
    expect(alert?.severity).toBe("INFO");
    expect(alert?.confirmSeconds).toBe(15);
  });

  test("CRITICAL for an identified target crossing a CLOSED area at speed", () => {
    const [alert] = evaluate([at({ groundSpeed: 20 })], { status: "CLOSED" });
    expect(alert?.severity).toBe("CRITICAL");
  });

  test("only WARNING when it is slow in a CLOSED area (it is not crossing it)", () => {
    const [alert] = evaluate([at({ groundSpeed: 5 })], { status: "CLOSED" });
    expect(alert?.severity).toBe("WARNING");
  });

  test("speed in an ordinary restricted area does not make it CRITICAL", () => {
    const [alert] = evaluate([at({ groundSpeed: 20 })]);
    expect(alert?.severity).toBe("WARNING");
  });

  test("which statuses are critical can be set in the rule configuration", () => {
    const [alert] = evaluate(
      [at({ groundSpeed: 20 })],
      { status: "NOTAM_WORKS" },
      {
        criticalAreaStatuses: ["NOTAM_WORKS"],
      },
    );
    expect(alert?.severity).toBe("CRITICAL");
  });

  test("an airborne target is not in the area", () => {
    expect(evaluate([at({ onGround: false })])).toHaveLength(0);
  });

  test("a target right on the edge is not counted (position jitter at the border)", () => {
    // About 1 m inside the northern edge of the area; the margin is 5 m.
    const edge = at({ latitude: -7.38 - 1 / 111_320 });
    expect(evaluate([edge])).toHaveLength(0);
    const inside = at({ latitude: -7.38 - 20 / 111_320 });
    expect(evaluate([inside])).toHaveLength(1);
  });
});
