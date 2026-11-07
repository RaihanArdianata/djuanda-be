import { describe, expect, it } from "bun:test";
import { runwayIncursionRule } from "./rules/incursion/runway-incursion.rule";
import {
  aircraftKey,
  createSameAircraftFilter,
  DEFAULT_SAME_AIRCRAFT,
  sameAircraftFromEnv,
} from "./same-aircraft";
import type { AlertContext, MovementTrack } from "./types";

let seq = 0;
const track = (over: Partial<MovementTrack> = {}): MovementTrack => ({
  trackId: `t${++seq}`,
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.38,
  longitude: 112.78,
  groundSpeed: 20,
  onGround: true,
  timestamp: new Date(1_000_000),
  ...over,
});

const ids = (tracks: MovementTrack[]) => tracks.map((t) => t.trackId);

describe("aircraftKey", () => {
  it("is the callsign without case, spaces, dashes or the zero after the airline", () => {
    expect(aircraftKey({ callsign: "btk 241" })).toBe("cs:BTK241");
    expect(aircraftKey({ callsign: "BTK0241" })).toBe("cs:BTK241");
    expect(aircraftKey({ callsign: "BTK241" })).toBe("cs:BTK241");
  });

  it("falls back to the registration, and is null for a nameless track", () => {
    expect(aircraftKey({ callsign: undefined, registration: "PK-LAB" })).toBe(
      "reg:PKLAB",
    );
    expect(aircraftKey({ callsign: "  ", registration: undefined })).toBeNull();
    expect(aircraftKey({})).toBeNull();
  });

  it("keeps different flights apart", () => {
    expect(aircraftKey({ callsign: "BTK241" })).not.toBe(
      aircraftKey({ callsign: "BTK2410" }),
    );
  });
});

describe("one aircraft, one track", () => {
  it("keeps one of two tracks with the same callsign (MLAT and ADS-B of BTK241)", () => {
    const f = createSameAircraftFilter();
    const mlat = track({ trackId: "mlat", callsign: "BTK241" });
    const adsb = track({ trackId: "adsb", callsign: "BTK241" });
    expect(f.apply("WARR", [mlat, adsb])).toHaveLength(1);
    expect(f.merged).toBe(1);
  });

  it("keeps different aircraft, even side by side", () => {
    const f = createSameAircraftFilter();
    const a = track({ callsign: "BTK241" });
    const b = track({ callsign: "LNI316", latitude: -7.3801 });
    expect(ids(f.apply("WARR", [a, b]))).toEqual(ids([a, b]));
  });

  it("does not touch tracks that never had a twin", () => {
    const f = createSameAircraftFilter();
    const list = [
      track({ callsign: "A" }),
      track({ callsign: "B", latitude: -7.381 }),
      track({ latitude: -7.39 }), // a nameless track, but nowhere near a named one
    ];
    expect(f.apply("WARR", list)).toHaveLength(3);
    expect(f.merged).toBe(0);
  });

  it("keeps the same track while it is there, even when the other one is fresher", () => {
    const f = createSameAircraftFilter();
    const first = track({
      trackId: "a",
      callsign: "BTK241",
      timestamp: new Date(1_000),
    });
    const second = track({
      trackId: "b",
      callsign: "BTK241",
      timestamp: new Date(2_000),
    });
    // the first call picks the fresher one ...
    expect(ids(f.apply("WARR", [first, second]))).toEqual(["b"]);
    // ... and from then on the choice holds, whichever is fresher: one occurrence stays one alert
    const first2 = { ...first, timestamp: new Date(9_000) };
    const second2 = { ...second, timestamp: new Date(3_000) };
    expect(ids(f.apply("WARR", [first2, second2]))).toEqual(["b"]);
  });

  it("moves to the other track when the one kept is gone", () => {
    const f = createSameAircraftFilter();
    const a = track({
      trackId: "a",
      callsign: "BTK241",
      timestamp: new Date(2_000),
    });
    const b = track({
      trackId: "b",
      callsign: "BTK241",
      timestamp: new Date(1_000),
    });
    expect(ids(f.apply("WARR", [a, b]))).toEqual(["a"]);
    expect(ids(f.apply("WARR", [b]))).toEqual(["b"]);
  });

  it("chooses the same way whatever the order, the lower id among equals", () => {
    const a = track({ trackId: "a", callsign: "BTK241" });
    const b = track({ trackId: "b", callsign: "BTK241" });
    expect(ids(createSameAircraftFilter().apply("WARR", [a, b]))).toEqual([
      "a",
    ]);
    expect(ids(createSameAircraftFilter().apply("WARR", [b, a]))).toEqual([
      "a",
    ]);
  });

  it("keeps airports apart", () => {
    const f = createSameAircraftFilter();
    f.apply("WARR", [
      track({ trackId: "a", callsign: "X1", timestamp: new Date(2_000) }),
      track({ trackId: "b", callsign: "X1", timestamp: new Date(1_000) }),
    ]);
    const other = [track({ trackId: "c", callsign: "X1", airportId: "WIII" })];
    expect(ids(f.apply("WIII", other))).toEqual(["c"]);
  });
});

describe("a track with no name on top of a named one", () => {
  const named = () =>
    track({
      trackId: "n",
      callsign: "BTK241",
      latitude: -7.38,
      longitude: 112.78,
      groundSpeed: 20,
    });

  it("is dropped when it sits within the radius, of the same kind, at about the same speed", () => {
    const f = createSameAircraftFilter();
    const nameless = track({
      trackId: "x",
      latitude: -7.38002,
      longitude: 112.78002,
      groundSpeed: 24,
    });
    expect(ids(f.apply("WARR", [named(), nameless]))).toEqual(["n"]);
  });

  it("stays when it is farther than the radius", () => {
    const f = createSameAircraftFilter();
    const far = track({ trackId: "x", latitude: -7.381, longitude: 112.78 }); // about 110 m
    expect(ids(f.apply("WARR", [named(), far]))).toEqual(["n", "x"]);
  });

  it("stays when it is another kind of target (a vehicle beside an aircraft)", () => {
    const f = createSameAircraftFilter();
    const vehicle = track({
      trackId: "v",
      targetType: "VEHICLE",
      latitude: -7.38001,
    });
    expect(ids(f.apply("WARR", [named(), vehicle]))).toEqual(["n", "v"]);
  });

  it("stays when it moves at another speed", () => {
    const f = createSameAircraftFilter();
    const fast = track({ trackId: "x", latitude: -7.38001, groundSpeed: 90 });
    expect(ids(f.apply("WARR", [named(), fast]))).toEqual(["n", "x"]);
  });

  it("two nameless tracks side by side are not merged with each other", () => {
    const f = createSameAircraftFilter();
    const a = track({ trackId: "a", targetType: "VEHICLE" });
    const b = track({
      trackId: "b",
      targetType: "VEHICLE",
      latitude: -7.38001,
    });
    expect(ids(f.apply("WARR", [a, b]))).toEqual(["a", "b"]);
  });

  it("is never judged by place when the radius is 0", () => {
    const f = createSameAircraftFilter({
      ...DEFAULT_SAME_AIRCRAFT,
      twinRadiusM: 0,
    });
    const nameless = track({ trackId: "x", latitude: -7.38001 });
    expect(ids(f.apply("WARR", [named(), nameless]))).toEqual(["n", "x"]);
  });
});

describe("sameAircraftFromEnv", () => {
  it("reads the radius and speed difference, and ignores what is not a number", () => {
    expect(
      sameAircraftFromEnv({
        ALERT_TWIN_RADIUS_M: "100",
        ALERT_TWIN_MAX_SPEED_DIFF_KT: "5",
      }),
    ).toEqual({
      twinRadiusM: 100,
      twinMaxSpeedDiffKt: 5,
    });
    expect(sameAircraftFromEnv({ ALERT_TWIN_RADIUS_M: "abc" })).toEqual(
      DEFAULT_SAME_AIRCRAFT,
    );
    expect(sameAircraftFromEnv({ ALERT_TWIN_RADIUS_M: "0" }).twinRadiusM).toBe(
      0,
    );
    expect(sameAircraftFromEnv({})).toEqual(DEFAULT_SAME_AIRCRAFT);
  });
});

describe("the runway rule on what the filter leaves", () => {
  // a runway of 400 m x 60 m around (-7.38, 112.78)
  const runway = {
    id: "rwy",
    name: "10/28",
    status: "ACTIVE",
    active: true,
    polygon: [
      [-7.3797, 112.778],
      [-7.3797, 112.782],
      [-7.3803, 112.782],
      [-7.3803, 112.778],
    ] as [number, number][],
  };
  const ctx = (tracks: MovementTrack[]): AlertContext => ({
    tracks,
    airportId: "WARR",
    timestamp: new Date(1_000_000),
    aerodrome: { features: [], runways: [runway], surfaces: [], areas: [] },
  });
  const incursions = (tracks: MovementTrack[]) =>
    runwayIncursionRule.evaluate(ctx(tracks), {});

  it("raises an incursion against itself on the unfiltered tracks: the bug", () => {
    const mlat = track({ trackId: "mlat", callsign: "BTK241" });
    const adsb = track({
      trackId: "adsb",
      callsign: "BTK241",
      latitude: -7.38001,
    });
    expect(incursions([mlat, adsb]).length).toBeGreaterThan(0);
  });

  it("raises none once the same aircraft is counted once", () => {
    const f = createSameAircraftFilter();
    const mlat = track({ trackId: "mlat", callsign: "BTK241" });
    const adsb = track({
      trackId: "adsb",
      callsign: "BTK241",
      latitude: -7.38001,
    });
    expect(incursions(f.apply("WARR", [mlat, adsb]))).toHaveLength(0);
  });

  it("still raises one for a second, different aircraft on the runway", () => {
    const f = createSameAircraftFilter();
    const occupant = track({
      trackId: "o",
      callsign: "BTK241",
      longitude: 112.779,
    });
    const intruder = track({
      trackId: "i",
      callsign: "LNI316",
      longitude: 112.7815,
    });
    expect(
      incursions(f.apply("WARR", [occupant, intruder])).length,
    ).toBeGreaterThan(0);
  });
});

describe("configure", () => {
  it("changes the thresholds while running", () => {
    const f = createSameAircraftFilter();
    const named = track({ trackId: "n", callsign: "BTK241" });
    const nameless = track({
      trackId: "x",
      latitude: -7.381,
      longitude: 112.78,
    }); // about 110 m away
    expect(ids(f.apply("WARR", [named, nameless]))).toEqual(["n", "x"]);
    f.configure({ ...DEFAULT_SAME_AIRCRAFT, twinRadiusM: 200 });
    expect(ids(f.apply("WARR", [named, nameless]))).toEqual(["n"]);
    f.configure({ ...DEFAULT_SAME_AIRCRAFT, twinRadiusM: 0 });
    expect(ids(f.apply("WARR", [named, nameless]))).toEqual(["n", "x"]);
  });
});
