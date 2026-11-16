import { describe, expect, test } from "bun:test";
import type { MovementTrack } from "../types";
import { isIdentified, isMovingAbove, isOnSurface } from "./identity";

const track = (over: Partial<MovementTrack> = {}): MovementTrack => ({
  trackId: "ast_x",
  airportId: "WARR",
  targetType: "AIRCRAFT",
  latitude: 0,
  longitude: 0,
  timestamp: new Date(),
  ...over,
});

describe("isIdentified", () => {
  test("a callsign, a registration or a vehicle fleet is an identity", () => {
    expect(isIdentified(track({ callsign: "GIA349" }))).toBe(true);
    expect(isIdentified(track({ registration: "PK-GFI" }))).toBe(true);
    expect(isIdentified(track({ vehicleFleet: "OPS" }))).toBe(true);
  });

  test("a track id alone is not", () => {
    expect(isIdentified(track())).toBe(false);
    expect(isIdentified(track({ callsign: "  " }))).toBe(false);
  });
});

describe("isMovingAbove", () => {
  test("compares the ground speed with the threshold, a missing speed counting as standing", () => {
    expect(isMovingAbove(track({ groundSpeed: 5 }), 3)).toBe(true);
    expect(isMovingAbove(track({ groundSpeed: 2 }), 3)).toBe(false);
    expect(isMovingAbove(track(), 3)).toBe(false);
  });
});

describe("isOnSurface", () => {
  test("follows the on-ground flag", () => {
    expect(isOnSurface(track({ onGround: true }))).toBe(true);
    expect(isOnSurface(track({ onGround: false }))).toBe(false);
  });

  test("without the flag, high altitude means airborne", () => {
    expect(isOnSurface(track({ altitude: 2000 }))).toBe(false);
    expect(isOnSurface(track({ altitude: 100 }))).toBe(true);
    expect(isOnSurface(track())).toBe(true);
  });
});
