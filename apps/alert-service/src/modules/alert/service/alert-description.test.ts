import { describe, expect, it } from "bun:test";
import type { Alert } from "@repo/database";
import {
  describeAlert,
  toJakartaIso,
  withDescription,
} from "./alert-description";

const alert = (over: Partial<Alert> = {}): Alert =>
  ({
    id: "id1",
    alertId: "RUNWAY_INCURSION|WARR|x",
    airportId: "WARR",
    type: "RUNWAY_INCURSION",
    severity: "CRITICAL",
    status: "ACTIVE",
    trackId: "t1",
    relatedTrackId: "t2",
    triggeredAt: new Date("2026-11-08T14:16:24Z"),
    data: {
      callsign: "UKL5002",
      relatedCallsign: "SJV201",
      runwayName: "10/28",
      runwayStatus: "ACTIVE",
    },
    ...over,
  }) as Alert;

describe("toJakartaIso", () => {
  it("writes the wall-clock time in Jakarta", () => {
    expect(toJakartaIso(new Date("2026-11-08T14:16:24Z"))).toBe(
      "2026-11-08T21:16:24+07:00",
    );
    expect(toJakartaIso("2026-11-08T23:30:00Z")).toBe(
      "2026-11-09T06:30:00+07:00",
    );
  });

  it("is null for something that is not a date", () => {
    expect(toJakartaIso("nonsense")).toBeNull();
  });
});

describe("describeAlert", () => {
  it("builds the same sentence as the statistics export, with the time in WIB", () => {
    const text = describeAlert(alert());
    expect(text).toContain("Potensi Runway Incursion");
    expect(text).toContain(
      "aircraft callsign UKL5002 memasuki runway 10/28 yang sedang dipakai aircraft callsign SJV201",
    );
    expect(text).toContain("8 November 2026 pukul 21:16:24 WIB");
    expect(text).toContain("severity CRITICAL");
  });

  it("is null for a type the report does not describe", () => {
    expect(describeAlert(alert({ type: "WEATHER_MINIMA" }))).toBeNull();
  });
});

describe("withDescription", () => {
  it("adds the description to the alert and keeps its own fields", () => {
    const out = withDescription(alert());
    expect(out.alertId).toBe("RUNWAY_INCURSION|WARR|x");
    expect(out.description).toContain("Potensi");
  });
});
