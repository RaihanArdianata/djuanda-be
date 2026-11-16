import { describe, expect, it } from "bun:test";
import { groupIncidents, type IncidentAlertInput } from "./alert-incident";

const T0 = Date.parse("2026-11-17T01:00:00Z");
let seq = 0;

const alert = (over: Partial<IncidentAlertInput> = {}): IncidentAlertInput => ({
  alertId: `n${String(++seq).padStart(4, "0")}`,
  type: "AREA_PENETRATION",
  severity: "WARNING",
  status: "CLEARED",
  triggeredAt: T0 + seq * 1000,
  callsign: "GIA349",
  relatedCallsign: null,
  trackId: "ast_1",
  verificationStatus: "UNVERIFIED",
  ...over,
});

const first = (alerts: IncidentAlertInput[]) => {
  const incident = groupIncidents(alerts)[0];
  if (!incident) throw new Error("no incident");
  return incident;
};

describe("incident needsAction", () => {
  it("is true for an unverified Warning or Critical alert", () => {
    expect(first([alert({ severity: "WARNING" })]).needsAction).toBe(true);
    expect(first([alert({ severity: "CRITICAL" })]).needsAction).toBe(true);
  });

  it("is false for an incident that holds only Info alerts: they are for awareness, not for action", () => {
    expect(first([alert({ severity: "INFO" })]).needsAction).toBe(false);
    expect(
      first([alert({ severity: "INFO" }), alert({ severity: "INFO" })])
        .needsAction,
    ).toBe(false);
  });

  it("is true when an Info alert is joined by a Warning alert that nobody has judged", () => {
    expect(
      first([alert({ severity: "INFO" }), alert({ severity: "WARNING" })])
        .needsAction,
    ).toBe(true);
  });

  it("is false once the Warning and Critical alerts are judged, even if an Info alert is still unverified", () => {
    const incident = first([
      alert({ severity: "WARNING", verificationStatus: "VERIFIED" }),
      alert({ severity: "CRITICAL", verificationStatus: "FALSE_ALARM" }),
      alert({ severity: "INFO" }),
    ]);
    expect(incident.needsAction).toBe(false);
    // The roll-up of verification still counts every alert.
    expect(incident.verificationCounts.unverified).toBe(1);
  });

  it("is false for an incident that is fully verified", () => {
    expect(first([alert({ verificationStatus: "VERIFIED" })]).needsAction).toBe(
      false,
    );
  });
});
