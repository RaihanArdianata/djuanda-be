import { describe, expect, it } from "bun:test";
import {
  groupIncidents,
  type IncidentAlertInput,
} from "@repo/shared/alert-incident";
import {
  composeVerificationNote,
  filterIncidents,
  needsCriticalConfirmation,
  paginate,
} from "./incident-query";

const T0 = Date.parse("2026-11-08T12:00:00Z");
let n = 0;
const alert = (
  minute: number,
  over: Partial<IncidentAlertInput> = {},
): IncidentAlertInput => ({
  alertId: `a${++n}`,
  type: "TAXIWAY_APRON_INCURSION",
  severity: "WARNING",
  status: "CLEARED",
  triggeredAt: T0 + minute * 60_000,
  callsign: "CTV494",
  relatedCallsign: null,
  trackId: "t",
  verificationStatus: "UNVERIFIED",
  ...over,
});

const incidents = groupIncidents([
  alert(0, { callsign: "CTV494" }),
  alert(2, {
    callsign: "CTV494",
    type: "RUNWAY_INCURSION",
    severity: "CRITICAL",
    relatedCallsign: "SJY567",
    status: "ACTIVE",
  }),
  alert(100, { callsign: "GIA320", verificationStatus: "VERIFIED" }),
  alert(200, {
    callsign: "SIA929",
    type: "STCA",
    relatedCallsign: "GIA320",
    severity: "CRITICAL",
  }),
]);

const names = (list: typeof incidents) =>
  list.map((i) => i.callsign ?? i.pair?.join("/")).sort();

describe("filterIncidents", () => {
  it("keeps the incidents that contain a type", () => {
    expect(
      names(filterIncidents(incidents, { type: "runway_incursion" })),
    ).toEqual(["CTV494"]);
  });

  it("filters by the highest severity of the incident", () => {
    expect(filterIncidents(incidents, { severity: "CRITICAL" })).toHaveLength(
      2,
    );
    expect(names(filterIncidents(incidents, { severity: "WARNING" }))).toEqual([
      "GIA320",
    ]);
  });

  it("tells an incident with an active alert from a finished one", () => {
    expect(names(filterIncidents(incidents, { status: "ACTIVE" }))).toEqual([
      "CTV494",
    ]);
    expect(filterIncidents(incidents, { status: "CLEARED" })).toHaveLength(2);
  });

  it("filters by verification, and finds what still needs a decision", () => {
    expect(
      names(filterIncidents(incidents, { verification: "VERIFIED" })),
    ).toEqual(["GIA320"]);
    expect(
      filterIncidents(incidents, { verification: "NEEDS_ACTION" }),
    ).toHaveLength(2);
  });

  it("searches callsigns, related aircraft and types, every word having to match", () => {
    expect(names(filterIncidents(incidents, { q: "ctv494" }))).toEqual([
      "CTV494",
    ]);
    expect(names(filterIncidents(incidents, { q: "sjy567" }))).toEqual([
      "CTV494",
    ]);
    expect(names(filterIncidents(incidents, { q: "ctv494 runway" }))).toEqual([
      "CTV494",
    ]);
    expect(filterIncidents(incidents, { q: "ctv494 stca" })).toHaveLength(0);
  });

  it("finds a conflict from either aircraft of the pair", () => {
    expect(filterIncidents(incidents, { q: "SIA929" })).toHaveLength(1);
    expect(filterIncidents(incidents, { q: "GIA320 STCA" })).toHaveLength(1);
  });
});

describe("paginate", () => {
  it("takes one page of the list", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(paginate([1, 2, 3], 3, 2)).toEqual([]);
  });
});

describe("composeVerificationNote", () => {
  it("puts the standard reason in front of the free note", () => {
    expect(composeVerificationNote("RADAR_NOISE", "terlihat di radar 2")).toBe(
      "Derau radar: terlihat di radar 2",
    );
    expect(composeVerificationNote("SCHEDULED_MOVEMENT", undefined)).toBe(
      "Pergerakan terjadwal",
    );
    expect(composeVerificationNote(undefined, "  dikonfirmasi tower ")).toBe(
      "dikonfirmasi tower",
    );
    expect(composeVerificationNote(undefined, "  ")).toBeUndefined();
  });
});

describe("needsCriticalConfirmation", () => {
  it("asks for confirmation as soon as a critical alert is included", () => {
    expect(needsCriticalConfirmation(["WARNING", "CRITICAL"])).toBe(true);
    expect(needsCriticalConfirmation(["WARNING", "CAUTION"])).toBe(false);
  });
});
