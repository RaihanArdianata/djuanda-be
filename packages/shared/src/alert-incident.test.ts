import { describe, expect, it } from "bun:test";
import {
  groupIncidents,
  INCIDENT_WINDOW_MS,
  type IncidentAlertInput,
  incidentCountByType,
  incidentSubject,
} from "./alert-incident";

const T0 = Date.parse("2026-11-08T12:00:00Z");
const MIN = 60_000;
let seq = 0;

const alert = (
  minute: number,
  over: Partial<IncidentAlertInput> = {},
): IncidentAlertInput => ({
  alertId: `a${String(++seq).padStart(4, "0")}`,
  type: "TAXIWAY_APRON_INCURSION",
  severity: "WARNING",
  status: "CLEARED",
  triggeredAt: T0 + minute * MIN,
  callsign: "CTV494",
  relatedCallsign: null,
  trackId: "ast_1",
  verificationStatus: "UNVERIFIED",
  ...over,
});

describe("incidentSubject", () => {
  it("keys an incursion by its callsign, whatever the case or spaces", () => {
    expect(incidentSubject(alert(0, { callsign: " ctv494 " })).subject).toBe(
      "SUBJ:CTV494",
    );
  });

  it("keys a conflict by the pair of callsigns, without order", () => {
    const ab = incidentSubject(
      alert(0, { type: "STCA", callsign: "SIA929", relatedCallsign: "GIA320" }),
    );
    const ba = incidentSubject(
      alert(0, { type: "STCA", callsign: "GIA320", relatedCallsign: "SIA929" }),
    );
    expect(ab.subject).toBe("PAIR:GIA320|SIA929");
    expect(ab.subject).toBe(ba.subject);
    expect(ab.kind).toBe("PAIR");
  });

  it("falls back to the track id when there is no callsign, so nameless alerts do not merge with each other", () => {
    const a = incidentSubject(alert(0, { callsign: null, trackId: "ast_9" }));
    const b = incidentSubject(alert(0, { callsign: null, trackId: "ast_10" }));
    expect(a.subject).toBe("SUBJ:AST_9");
    expect(a.subject).not.toBe(b.subject);
  });
});

describe("groupIncidents: the chain", () => {
  it("joins alerts of one callsign that follow each other within 15 minutes, across alert types", () => {
    const [incident, ...rest] = groupIncidents([
      alert(0, { type: "TAXIWAY_APRON_INCURSION" }),
      alert(1, { type: "AREA_PENETRATION" }),
      alert(6, {
        type: "RUNWAY_INCURSION",
        severity: "CRITICAL",
        relatedCallsign: "SJY567",
      }),
    ]);
    expect(rest).toHaveLength(0);
    expect(incident?.count).toBe(3);
    expect(incident?.typeCounts).toEqual({
      TAXIWAY_APRON_INCURSION: 1,
      AREA_PENETRATION: 1,
      RUNWAY_INCURSION: 1,
    });
    expect(incident?.severity).toBe("CRITICAL");
    expect(incident?.relatedCallsigns).toEqual(["SJY567"]);
    expect(incident?.endAt - (incident?.startAt ?? 0)).toBe(6 * MIN);
  });

  it("starts a new incident after a gap longer than 15 minutes", () => {
    const incidents = groupIncidents([alert(0), alert(10), alert(10 + 16)]);
    expect(incidents.map((i) => i.count)).toEqual([1, 2]);
  });

  it("measures the gap from the last alert of the chain, so a long incident stays one", () => {
    const alerts = [0, 10, 20, 30, 40, 50].map((m) => alert(m));
    expect(groupIncidents(alerts)).toHaveLength(1);
  });

  it("keeps a 15 minute gap inside and a gap just over it outside", () => {
    expect(
      groupIncidents([alert(0), alert(INCIDENT_WINDOW_MS / MIN)]),
    ).toHaveLength(1);
    expect(
      groupIncidents([alert(0), alert(INCIDENT_WINDOW_MS / MIN + 0.1)]),
    ).toHaveLength(2);
  });

  it("keeps different callsigns apart and does not need its input sorted", () => {
    const incidents = groupIncidents([
      alert(5, { callsign: "GIA320" }),
      alert(0, { callsign: "CTV494" }),
      alert(1, { callsign: "GIA320" }),
    ]);
    expect(incidents).toHaveLength(2);
    expect(incidents.find((i) => i.callsign === "GIA320")?.count).toBe(2);
  });

  it("orders the incidents newest first", () => {
    const incidents = groupIncidents([
      alert(0, { callsign: "A" }),
      alert(60, { callsign: "B" }),
    ]);
    expect(incidents.map((i) => i.callsign)).toEqual(["B", "A"]);
  });

  it("uses the first alert as the incident id", () => {
    const first = alert(0);
    const incident = groupIncidents([alert(3), first])[0];
    expect(incident?.id).toBe(first.alertId);
  });
});

describe("groupIncidents: conflicts", () => {
  it("makes one incident per pair, apart from the incursions of either aircraft", () => {
    const incidents = groupIncidents([
      alert(0, {
        type: "STCA",
        callsign: "SIA929",
        relatedCallsign: "GIA320",
        severity: "CRITICAL",
      }),
      alert(2, {
        type: "STCA",
        callsign: "GIA320",
        relatedCallsign: "SIA929",
        severity: "CRITICAL",
      }),
      alert(1, { type: "RUNWAY_INCURSION", callsign: "GIA320" }),
    ]);
    expect(incidents).toHaveLength(2);
    const pair = incidents.find((i) => i.kind === "PAIR");
    expect(pair?.count).toBe(2);
    expect(pair?.pair).toEqual(["GIA320", "SIA929"]);
    expect(pair?.callsign).toBeNull();
  });
});

describe("groupIncidents: status and verification", () => {
  it("is active while any member is active", () => {
    expect(
      groupIncidents([alert(0), alert(1, { status: "ACTIVE" })])[0]?.hasActive,
    ).toBe(true);
    expect(groupIncidents([alert(0), alert(1)])[0]?.hasActive).toBe(false);
  });

  it("rolls the verification up: all verified, all false alarm, none, or mixed", () => {
    const verified = (s: string) => alert(0, { verificationStatus: s });
    expect(
      groupIncidents([verified("VERIFIED"), verified("VERIFIED")])[0]
        ?.verification,
    ).toBe("VERIFIED");
    expect(
      groupIncidents([verified("FALSE_ALARM"), verified("FALSE_ALARM")])[0]
        ?.verification,
    ).toBe("FALSE_ALARM");
    expect(
      groupIncidents([verified("UNVERIFIED"), verified("UNVERIFIED")])[0]
        ?.verification,
    ).toBe("UNVERIFIED");
    expect(
      groupIncidents([verified("VERIFIED"), verified("FALSE_ALARM")])[0]
        ?.verification,
    ).toBe("MIXED");
  });

  it("counts the alerts that came after the verification, for the apply-also button", () => {
    const incident = groupIncidents([
      alert(0, { verificationStatus: "VERIFIED" }),
      alert(1, { verificationStatus: "VERIFIED" }),
      alert(2, { verificationStatus: "UNVERIFIED" }),
    ])[0];
    expect(incident?.verification).toBe("MIXED");
    expect(incident?.newAfterVerification).toBe(1);
    expect(groupIncidents([alert(0), alert(1)])[0]?.newAfterVerification).toBe(
      0,
    );
  });
});

describe("incidentCountByType", () => {
  it("counts an incident once under each alert type it contains", () => {
    const incidents = groupIncidents([
      alert(0, { type: "TAXIWAY_APRON_INCURSION" }),
      alert(1, { type: "TAXIWAY_APRON_INCURSION" }),
      alert(2, { type: "RUNWAY_INCURSION" }),
      alert(90, { callsign: "GIA320", type: "TAXIWAY_APRON_INCURSION" }),
    ]);
    expect(incidentCountByType(incidents)).toEqual({
      TAXIWAY_APRON_INCURSION: 2,
      RUNWAY_INCURSION: 1,
    });
  });
});
