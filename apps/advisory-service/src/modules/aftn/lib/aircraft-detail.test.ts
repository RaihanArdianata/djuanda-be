import { describe, expect, it } from "bun:test";
import type { AftnMessage } from "@repo/database";
import {
  buildAftnAircraftDetail,
  LATEST_WINDOW_MS,
  latestWindowStart,
} from "./aircraft-detail";

const row = (override: Partial<AftnMessage>): AftnMessage =>
  ({
    id: "id",
    datetime: new Date("2025-10-17T08:00:00.000Z"),
    messageType: "FPL",
    callSign: "GA123",
    registration: null,
    departure: null,
    departureTime: null,
    destination: null,
    destinationTime: null,
    route: null,
    ...override,
  }) as AftnMessage;

describe("buildAftnAircraftDetail", () => {
  it("returns null without rows", () => {
    expect(buildAftnAircraftDetail([])).toBeNull();
  });

  it("takes status/id/datetime from the newest row and fills gaps from older ones", () => {
    const dep = row({
      id: "dep",
      messageType: "DEP",
      datetime: new Date("2025-10-17T09:00:00.000Z"),
      departure: "WADD",
      departureTime: "1500",
      destination: "WARR",
    });
    const fpl = row({
      id: "fpl",
      departure: "WADD",
      departureTime: "1430",
      destination: "WARR",
      route: "DCT",
      registration: "PKGAA",
    });

    expect(buildAftnAircraftDetail([dep, fpl])).toEqual({
      id: "dep",
      callSign: "GA123",
      registration: "PKGAA",
      datetime: new Date("2025-10-17T09:00:00.000Z"),
      status: "DEP",
      route: "DCT",
      dep: { icao: "WADD", time: "1500" },
      arrival: { icao: "WARR", time: null },
    });
  });

  it("keeps null when no row has the value", () => {
    const result = buildAftnAircraftDetail([row({})]);
    expect(result?.route).toBeNull();
    expect(result?.dep).toEqual({ icao: null, time: null });
  });
});

describe("latestWindowStart", () => {
  it("looks back 48 hours, so month-old messages never count as the current schedule", () => {
    const now = Date.UTC(2026, 10, 2, 0, 0);
    expect(LATEST_WINDOW_MS).toBe(48 * 3_600_000);
    expect(latestWindowStart(now).toISOString()).toBe(
      "2026-10-31T00:00:00.000Z",
    );
    // The stale BTK6391 DEP from 30 May 2026 falls outside the window.
    expect(new Date("2026-05-30T22:16:00.000Z") < latestWindowStart(now)).toBe(
      true,
    );
  });
});
