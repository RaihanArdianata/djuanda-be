import { describe, expect, it } from "bun:test";
import type {
  AerodromeContextData,
  MovementTrack,
} from "../modules/engine/types";
import { computeOccupancy } from "./aerodrome.context";

// a taxiway of about 400 m x 60 m around (-7.38, 112.78)
const POLYGON: [number, number][] = [
  [-7.3797, 112.778],
  [-7.3797, 112.782],
  [-7.3803, 112.782],
  [-7.3803, 112.778],
];

const data = (): AerodromeContextData =>
  ({
    airportId: "WARR",
    features: [
      {
        id: "twy-1",
        layer: "taxiway",
        name: null,
        polygon: POLYGON,
        bbox: [-7.3803, 112.778, -7.3797, 112.782],
        properties: {},
      },
    ],
    runways: [],
    surfaces: [],
    areas: [],
  }) as unknown as AerodromeContextData;

const track = (over: Partial<MovementTrack> = {}): MovementTrack => ({
  trackId: "t1",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  callsign: "LNI581",
  latitude: -7.38,
  longitude: 112.78,
  altitude: 0,
  groundSpeed: 5,
  onGround: true,
  timestamp: new Date(),
  ...over,
});

describe("computeOccupancy", () => {
  it("reports the track that makes a polygon occupied, with its position", () => {
    const { occupancy, occupants } = computeOccupancy("WARR-T1", data(), [
      track(),
    ]);
    expect(occupancy[0]).toMatchObject({
      polygonId: "twy-1",
      status: "OCCUPIED",
      aircraftIds: ["t1"],
    });
    expect(occupants).toHaveLength(1);
    expect(occupants[0]).toMatchObject({
      trackId: "t1",
      callsign: "LNI581",
      latitude: -7.38,
      longitude: 112.78,
      polygonIds: ["twy-1"],
    });
    expect(occupants[0]?.ageMs).toBeLessThan(5_000);
  });

  it("lists no occupants for an empty polygon, for a track outside, or for one in the air", () => {
    expect(computeOccupancy("WARR-T2", data(), []).occupants).toEqual([]);
    expect(
      computeOccupancy("WARR-T3", data(), [track({ latitude: -7.5 })])
        .occupants,
    ).toEqual([]);
    expect(
      computeOccupancy("WARR-T4", data(), [
        track({ onGround: false, altitude: 3000 }),
      ]).occupants,
    ).toEqual([]);
  });

  it("counts a track with no ground flag and no altitude as being on the ground: such a track fills the polygon", () => {
    const { occupants } = computeOccupancy("WARR-T5", data(), [
      track({ onGround: undefined, altitude: undefined }),
    ]);
    expect(occupants.map((o) => o.trackId)).toEqual(["t1"]);
  });

  it("does not count a track whose last report is older than a minute", () => {
    const old = track({ timestamp: new Date(Date.now() - 120_000) });
    expect(computeOccupancy("WARR-T6", data(), [old]).occupants).toEqual([]);
  });
});
