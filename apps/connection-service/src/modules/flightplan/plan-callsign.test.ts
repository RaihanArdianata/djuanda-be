import { describe, expect, it } from "bun:test";
import type { FlightPlan } from "@aeroswarm/core/types";
import { callsignFromPlan } from "./plan-callsign";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const plan = (over: Partial<FlightPlan>): FlightPlan =>
  ({
    id: "p1",
    callsign: "LNI971",
    status: "filed",
    airportId: "WARR",
    firstSeenAt: NOW - 30 * HOUR,
    updatedAt: NOW,
    messageCount: 1,
    lastMessageType: "FPL",
    other: {},
    ...over,
  }) as FlightPlan;

const store = (
  p: FlightPlan | undefined,
): { find: () => FlightPlan | undefined } => ({
  find: () => p,
});

describe("callsignFromPlan", () => {
  it("names an aircraft from a plan close in time", () => {
    expect(
      callsignFromPlan(store(plan({ eobtAt: NOW - 2 * HOUR })), "8a082d", NOW),
    ).toBe("LNI971");
    expect(
      callsignFromPlan(store(plan({ atdAt: NOW - HOUR })), "8a082d", NOW),
    ).toBe("LNI971");
  });

  it("ignores a plan from another day: the same airframe flies several flights", () => {
    expect(
      callsignFromPlan(store(plan({ eobtAt: NOW - 20 * HOUR })), "8a082d", NOW),
    ).toBeUndefined();
    expect(callsignFromPlan(store(plan({})), "8a082d", NOW)).toBeUndefined();
  });

  it("returns nothing when no plan carries that Mode-S address", () => {
    expect(callsignFromPlan(store(undefined), "8a082d", NOW)).toBeUndefined();
  });
});
