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
