import { describe, expect, it } from "bun:test";
import { isAirborne } from "./airborne";
import {
  alertAreaFrom,
  centerFromEnv,
  DEFAULT_AIR_RADIUS_NM,
  DEFAULT_GROUND_RADIUS_M,
  isInAlertArea,
  tracksInAlertArea,
} from "./alert-area";
import type { MovementTrack } from "./types";

const CENTER = { centerLatitude: -7.3797, centerLongitude: 112.7868 };

const track = (over: Partial<MovementTrack> = {}): MovementTrack => ({
  trackId: "t",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: CENTER.centerLatitude,
  longitude: CENTER.centerLongitude,
  altitude: 0,
  groundSpeed: 10,
  heading: 90,
  onGround: true,
  timestamp: new Date(0),
  ...over,
});

describe("alertAreaFrom", () => {
  it("is null without a centre, so nothing is filtered", () => {
    expect(alertAreaFrom({}, {})).toBeNull();
    expect(alertAreaFrom(undefined, {})).toBeNull();
  });

  it("uses the radii of the rule, the defaults otherwise", () => {
    const area = alertAreaFrom(
      { ...CENTER, groundRadiusM: 3000, airRadiusNm: 20 },
      {},
    );
    expect(area?.groundRadiusM).toBe(3000);
    expect(area?.airRadiusM).toBeCloseTo(20 * 1852, 3);
    const defaults = alertAreaFrom(CENTER, {});
    expect(defaults?.groundRadiusM).toBe(DEFAULT_GROUND_RADIUS_M);
    expect(defaults?.airRadiusM).toBeCloseTo(DEFAULT_AIR_RADIUS_NM * 1852, 3);
  });

  it("ignores radii that are not positive numbers", () => {
    const area = alertAreaFrom(
      { ...CENTER, groundRadiusM: -5, airRadiusNm: "x" },
      {},
    );
    expect(area?.groundRadiusM).toBe(DEFAULT_GROUND_RADIUS_M);
    expect(area?.airRadiusM).toBeCloseTo(DEFAULT_AIR_RADIUS_NM * 1852, 3);
  });

  it("takes the centre from ALERT_AREA_CENTER when the rule has none", () => {
    expect(
      alertAreaFrom({}, { ALERT_AREA_CENTER: "-7.3797, 112.7868" })
        ?.centerLongitude,
    ).toBe(112.7868);
    // the rule wins over the environment
    expect(
      alertAreaFrom(
        { centerLatitude: 1, centerLongitude: 2 },
        { ALERT_AREA_CENTER: "-7,112" },
      )?.centerLatitude,
    ).toBe(1);
  });
});

describe("centerFromEnv", () => {
  it("reads lat,lon and rejects anything else", () => {
    expect(centerFromEnv("-7.38,112.79")).toEqual({ lat: -7.38, lon: 112.79 });
    for (const bad of [undefined, "", "1", "a,b", "1,2,3", "95,10", "10,200"]) {
      expect(centerFromEnv(bad)).toBeUndefined();
    }
  });
});

describe("isInAlertArea", () => {
  const area = alertAreaFrom(
    { ...CENTER, groundRadiusM: 5000, airRadiusNm: 15 },
    {},
  );
  if (!area) throw new Error("area");

  // 0.1 degree of latitude is about 11.1 km = 6 NM
  const at = (dLat: number, over: Partial<MovementTrack> = {}) =>
    track({ latitude: CENTER.centerLatitude + dLat, ...over });

  it("keeps a ground target inside the ground radius and drops one outside it", () => {
    expect(isInAlertArea(at(0.03), area, false)).toBe(true); // about 3.3 km
    expect(isInAlertArea(at(0.06), area, false)).toBe(false); // about 6.7 km
  });

  it("an aircraft in the air gets the larger air radius", () => {
    // 6 NM out: outside the ground radius, inside the air radius
    expect(isInAlertArea(at(0.1), area, false)).toBe(false);
    expect(isInAlertArea(at(0.1), area, true)).toBe(true);
    // 25 NM out: outside both
    expect(isInAlertArea(at(0.4), area, true)).toBe(false);
  });

  it("agrees with isAirborne on which radius a track uses", () => {
    const flying = at(0.1, {
      onGround: false,
      altitude: 3000,
      groundSpeed: 200,
    });
    const taxiing = at(0.1, { onGround: true });
    expect(isInAlertArea(flying, area, isAirborne(flying))).toBe(true);
    expect(isInAlertArea(taxiing, area, isAirborne(taxiing))).toBe(false);
  });
});

describe("tracksInAlertArea", () => {
  it("leaves out what is outside its zone, whichever kind it is", () => {
    const area = alertAreaFrom(
      { ...CENTER, groundRadiusM: 5000, airRadiusNm: 15 },
      {},
    );
    if (!area) throw new Error("area");
    const near = track({ trackId: "near" });
    const farGround = track({
      trackId: "farGround",
      latitude: CENTER.centerLatitude + 0.2,
    });
    const nearAir = track({
      trackId: "nearAir",
      onGround: false,
      altitude: 3000,
      groundSpeed: 200,
      latitude: CENTER.centerLatitude + 0.1,
    });
    const farAir = track({
      trackId: "farAir",
      onGround: false,
      altitude: 3000,
      groundSpeed: 200,
      latitude: CENTER.centerLatitude + 0.6,
    });
    expect(
      tracksInAlertArea([near, farGround, nearAir, farAir], area).map(
        (t) => t.trackId,
      ),
    ).toEqual(["near", "nearAir"]);
  });
});

describe("the air zone is a dome when there is a ceiling", () => {
  const dome = alertAreaFrom(
    { ...CENTER, groundRadiusM: 5000, airRadiusNm: 15, airCeilingFt: 10000 },
    {},
  );
  if (!dome) throw new Error("area");
  const flyingAt = (dLat: number, altitude: number | undefined) =>
    track({
      onGround: false,
      altitude,
      groundSpeed: 200,
      latitude: CENTER.centerLatitude + dLat,
    });

  it("has no ceiling unless one is set", () => {
    expect(alertAreaFrom(CENTER, {})?.airCeilingM).toBeNull();
    expect(
      alertAreaFrom({ ...CENTER, airCeilingFt: -1 }, {})?.airCeilingM,
    ).toBeNull();
    expect(dome.airCeilingM).toBeCloseTo(10000 * 0.3048, 3);
    // without a ceiling a very high aircraft over the airport is still inside
    const open = alertAreaFrom({ ...CENTER, airRadiusNm: 15 }, {});
    if (!open) throw new Error("area");
    expect(isInAlertArea(flyingAt(0.01, 40000), open, true)).toBe(true);
  });

  it("keeps an aircraft under the dome and leaves out one above it", () => {
    expect(isInAlertArea(flyingAt(0.01, 3000), dome, true)).toBe(true);
    expect(isInAlertArea(flyingAt(0.01, 25000), dome, true)).toBe(false);
    // right above the centre the dome is as high as the ceiling
    expect(isInAlertArea(flyingAt(0, 9500), dome, true)).toBe(true);
    expect(isInAlertArea(flyingAt(0, 10500), dome, true)).toBe(false);
  });

  it("is lower towards the edge: the same altitude is inside near the centre and outside near the rim", () => {
    // 5000 ft: inside near the centre; at about 14.4 NM (0.24 degrees) the dome is only about 2800 ft high
    expect(isInAlertArea(flyingAt(0.02, 5000), dome, true)).toBe(true);
    expect(isInAlertArea(flyingAt(0.24, 5000), dome, true)).toBe(false);
    expect(isInAlertArea(flyingAt(0.24, 500), dome, true)).toBe(true);
  });

  it("counts an altitude that is not reported as 0 ft, and does not apply to targets on the ground", () => {
    expect(isInAlertArea(flyingAt(0.01, undefined), dome, true)).toBe(true);
    expect(
      isInAlertArea(track({ altitude: 30000, onGround: true }), dome, false),
    ).toBe(true);
  });
});
