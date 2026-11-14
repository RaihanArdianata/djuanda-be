import { describe, expect, test } from "bun:test";
import { isAirborne } from "./airborne";
import type { MovementTrack } from "./types";

const now = new Date();

const track = (over: Partial<MovementTrack> = {}): MovementTrack => ({
  trackId: "T",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: -7.3797,
  longitude: 112.7868,
  timestamp: now,
  ...over,
});

describe("isAirborne", () => {
  test("onGround true is always the surface", () => {
    expect(
      isAirborne(track({ onGround: true, altitude: 400, groundSpeed: 30 })),
    ).toBe(false);
  });

  test("400 ft / 30 kt with onGround false is still in the air", () => {
    expect(
      isAirborne(track({ onGround: false, altitude: 400, groundSpeed: 30 })),
    ).toBe(true);
  });

  test("taxiing low and slow is the surface even when the feed says onGround false", () => {
    expect(
      isAirborne(track({ onGround: false, altitude: 50, groundSpeed: 8 })),
    ).toBe(false);
    expect(
      isAirborne(track({ onGround: false, altitude: 100, groundSpeed: 39 })),
    ).toBe(false);
  });

  test("above the taxi ceiling, slow speed does not force the surface", () => {
    expect(
      isAirborne(track({ onGround: false, altitude: 101, groundSpeed: 10 })),
    ).toBe(true);
  });

  test("without an onGround flag, only a clearly airborne altitude counts", () => {
    expect(isAirborne(track({ altitude: 800, groundSpeed: 0 }))).toBe(true);
    expect(isAirborne(track({ altitude: 100, groundSpeed: 0 }))).toBe(false);
    expect(isAirborne(track({ altitude: undefined, groundSpeed: 0 }))).toBe(
      false,
    );
  });
});
