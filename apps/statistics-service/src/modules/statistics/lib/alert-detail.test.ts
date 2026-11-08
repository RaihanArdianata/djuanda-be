import { describe, expect, it } from "bun:test";
import {
  type AlertDetailRow,
  formatMeters,
  formatNm,
  groupAlertDetails,
  incidentRefs,
  normalizeAlertRow,
  readVerification,
  summarizeIncidents,
} from "./alert-detail";

const row = (
  type: string,
  data: Record<string, unknown>,
  over: Partial<AlertDetailRow> = {},
): AlertDetailRow => ({
  airport_id: "WARR",
  type,
  severity: "WARNING",
  related_track_id: null,
  time: "2026-11-08T19:53:06+07:00",
  detail_data: data,
  ...over,
});

const describeRow = (r: AlertDetailRow): string =>
  normalizeAlertRow(r)?.detail.description ?? "";

describe("description of every alert type", () => {
  it("starts each one with the word potensi", () => {
    const rows = [
      row("STCA", { callsign: "SIA929" }),
      row("AREA_PENETRATION", {
        callsign: "PAS211",
        areaName: "A0002/26 NOTAMN",
      }),
      row("TAXIWAY_APRON_INCURSION", { callsign: "PAS211" }),
      row("RUNWAY_INCURSION", { callsign: "CTV494" }),
      row("DEVIATION", { callsign: "GIA313" }),
    ];
    for (const r of rows)
      expect(describeRow(r).startsWith("Potensi ")).toBe(true);
  });

  it("says when, where and how serious, for every type", () => {
    const text = describeRow(row("RUNWAY_INCURSION", { callsign: "CTV494" }));
    expect(text).toContain("8 November 2026 pukul 19:53:06 WIB");
    expect(text).toContain("airport WARR");
    expect(text).toContain("severity WARNING");
  });
});

describe("STCA", () => {
  it("gives the predicted distance, the time ahead and the limit, in nautical miles for airborne traffic", () => {
    const text = describeRow(
      row("STCA", {
        domain: "AIR",
        callsign: "SIA929",
        relatedCallsign: "GIA320",
        predictedTimeSeconds: 60,
        horizontalSeparationNm: 1.6,
        minimumHorizontalSeparationNm: 3,
        predictedVerticalSeparationFt: 200,
        minimumVerticalSeparationFt: 1000,
      }),
    );
    expect(text).toContain("STCA udara");
    expect(text).toContain(
      "aircraft callsign SIA929 dan aircraft callsign GIA320",
    );
    expect(text).toContain("jarak 1,6 NM dalam 60 detik");
    expect(text).toContain("batas pemisahan 3 NM");
    expect(text).toContain("selisih ketinggian 200 ft (batas 1000 ft)");
  });

  it("uses metres on the ground and leaves the vertical gap out", () => {
    const text = describeRow(
      row("STCA", {
        domain: "SURFACE",
        callsign: "A",
        relatedCallsign: "B",
        predictedTimeSeconds: 30,
        horizontalSeparationNm: 0.02,
        horizontalSeparationMeters: 38,
        minimumSeparationMeters: 50,
        predictedVerticalSeparationFt: 0,
      }),
    );
    expect(text).toContain("STCA darat");
    expect(text).toContain("jarak 38 m dalam 30 detik");
    expect(text).toContain("batas pemisahan 50 m");
    expect(text).not.toContain("ketinggian");
  });

  it("falls back to the related track id when the alert carries no figures", () => {
    const text = describeRow(
      row("STCA", { callsign: "SIA929" }, { related_track_id: "ast_1" }),
    );
    expect(text).toContain("related track ast_1");
  });
});

describe("area penetration", () => {
  it("names the area and explains why entering it counts", () => {
    const text = describeRow(
      row("AREA_PENETRATION", {
        callsign: "PAS211",
        areaName: "A0002/26 NOTAMN",
        areaType: "RESTRICTED",
        areaStatus: "RESTRICTED",
      }),
    );
    expect(text).toContain("restricted area A0002/26 NOTAMN");
    expect(text).toContain("bertipe RESTRICTED");
    expect(text).toContain(
      "dibatasi sehingga target yang masuk dianggap pelanggaran",
    );
  });
});

describe("taxiway/apron incursion", () => {
  it("gives the distance off the route and the limit", () => {
    const text = describeRow(
      row("TAXIWAY_APRON_INCURSION", {
        callsign: "PAS211",
        reason: "OFF_ROUTE",
        distanceMeters: 120,
        maxDistanceMeters: 100,
        surfaceType: "TAXIWAY",
        surfaceName: "NP2",
      }),
    );
    expect(text).toContain("menyimpang 120 m dari rute taxiway (batas 100 m)");
    expect(text).toContain("pada TAXIWAY NP2");
  });

  it("names the aircraft that was using the surface and the distance to it", () => {
    const text = describeRow(
      row("TAXIWAY_APRON_INCURSION", {
        callsign: "CTV673",
        relatedCallsign: "GIA320",
        distanceMeters: 45,
        criticalMeters: 60,
        surfaceType: "TAXIWAY",
      }),
    );
    expect(text).toContain("sedang dipakai aircraft callsign GIA320");
    expect(text).toContain("berjarak 45 m (batas kritis 60 m)");
  });
});

describe("runway incursion and deviation", () => {
  it("names the runway and who is using it", () => {
    const text = describeRow(
      row("RUNWAY_INCURSION", {
        callsign: "CTV494",
        runwayName: "10/28",
        relatedCallsign: "LNI311",
        runwayStatus: "ACTIVE",
      }),
    );
    expect(text).toContain(
      "runway 10/28 yang sedang dipakai aircraft callsign LNI311",
    );
    expect(text).toContain("status ACTIVE");
  });

  it("lists every deviation that was exceeded", () => {
    const text = describeRow(
      row("DEVIATION", {
        callsign: "GIA313",
        horizontalDistanceMeters: 1500,
        maxDistanceMeters: 1000,
        altitudeDeviationFt: -300,
        maxAltitudeDeviationFt: 200,
        timeExceeded: true,
        timeDeviationSeconds: 95,
      }),
    );
    expect(text).toContain("menyimpang 1,5 km dari rute (batas 1 km)");
    expect(text).toContain("selisih ketinggian 300 ft (batas 200 ft)");
    expect(text).toContain("selisih waktu 95 detik dari jadwal");
  });
});

describe("alert id", () => {
  it("carries the alert id so the front end can open the same alert", () => {
    expect(
      normalizeAlertRow(row("STCA", {}, { alert_id: "STCA|WARR|x" }))?.detail
        .alertId,
    ).toBe("STCA|WARR|x");
    expect(normalizeAlertRow(row("STCA", {}))?.detail.alertId).toBeNull();
  });
});

describe("distance text", () => {
  it("writes metres, switching to kilometres from 1000 m, and nautical miles", () => {
    expect(formatMeters(38.4)).toBe("38 m");
    expect(formatMeters(1300)).toBe("1,3 km");
    expect(formatNm(1.64)).toBe("1,6 NM");
  });
});

describe("verification", () => {
  it("is unverified with an empty history when the row carries nothing", () => {
    expect(readVerification(row("STCA", {}))).toEqual({
      status: "UNVERIFIED",
      by: null,
      at: null,
      note: null,
      history: [],
    });
  });

  it("reads who verified, when, the note and the history, oldest first as given", () => {
    const v = readVerification(
      row(
        "STCA",
        {},
        {
          verification_status: "VERIFIED",
          verified_by: "Budi",
          verified_at: "2026-11-08T20:00:00+07:00",
          verification_note: "Dikonfirmasi tower",
          verification_history: [
            {
              at: "2026-11-08T19:55:00+07:00",
              by: "Sari",
              from: "UNVERIFIED",
              to: "FALSE_ALARM",
              note: "Derau",
            },
            {
              at: "2026-11-08T20:00:00+07:00",
              by: "Budi",
              from: "FALSE_ALARM",
              to: "VERIFIED",
              note: "Dikonfirmasi tower",
            },
          ],
        },
      ),
    );
    expect(v.status).toBe("VERIFIED");
    expect(v.by).toBe("Budi");
    expect(v.history.map((h) => h.by)).toEqual(["Sari", "Budi"]);
  });

  it("reads a history that arrives as JSON text and ignores junk entries", () => {
    const v = readVerification(
      row(
        "STCA",
        {},
        {
          verification_history: JSON.stringify([
            { by: "Sari", to: "VERIFIED" },
            5,
            null,
          ]),
        },
      ),
    );
    expect(v.history).toHaveLength(1);
    expect(v.history[0]?.by).toBe("Sari");
  });
});

describe("summarizeIncidents", () => {
  const at = (
    minute: number,
    type: string,
    over: Partial<AlertDetailRow> = {},
    data: Record<string, unknown> = {},
  ) =>
    row(
      type,
      { callsign: "CTV494", ...data },
      {
        alert_id: `${type}|${minute}`,
        time: `2026-11-08T19:${String(minute).padStart(2, "0")}:00+07:00`,
        ...over,
      },
    );

  it("counts one incident for a flow that raised several alerts of several types", () => {
    const summary = summarizeIncidents([
      at(27, "TAXIWAY_APRON_INCURSION"),
      at(28, "AREA_PENETRATION"),
      at(33, "RUNWAY_INCURSION", { severity: "CRITICAL" }),
    ]);
    expect(summary.total).toBe(1);
    expect(summary.byCategory).toEqual({
      stca: 0,
      apa: 1,
      da: 0,
      ria: 1,
      taia: 1,
    });
    expect(summary.needsAction).toBe(1);
  });

  it("starts another incident after a gap of more than 15 minutes, and keeps callsigns apart", () => {
    const summary = summarizeIncidents([
      at(0, "TAXIWAY_APRON_INCURSION"),
      at(40, "TAXIWAY_APRON_INCURSION"),
      at(41, "TAXIWAY_APRON_INCURSION", {}, { callsign: "GIA320" }),
    ]);
    expect(summary.total).toBe(3);
  });

  it("does not need action once every alert of the incident has been judged", () => {
    const verified = { verification_status: "VERIFIED" };
    expect(
      summarizeIncidents([
        at(0, "TAXIWAY_APRON_INCURSION", verified),
        at(1, "AREA_PENETRATION", verified),
      ]).needsAction,
    ).toBe(0);
  });

  it("makes a conflict one incident per pair", () => {
    const summary = summarizeIncidents([
      at(0, "STCA", {}, { callsign: "SIA929", relatedCallsign: "GIA320" }),
      at(2, "STCA", {}, { callsign: "GIA320", relatedCallsign: "SIA929" }),
    ]);
    expect(summary.total).toBe(1);
    expect(summary.byCategory.stca).toBe(1);
  });
});

describe("incident of each alert", () => {
  const at = (hhmmss: string) => `2026-11-08T${hhmmss}+07:00`;
  const rows = [
    row(
      "AREA_PENETRATION",
      { callsign: "CTV494" },
      { alert_id: "a1", time: at("19:27:00") },
    ),
    row(
      "RUNWAY_INCURSION",
      { callsign: "CTV494" },
      { alert_id: "a2", time: at("19:33:00") },
    ),
    row(
      "AREA_PENETRATION",
      { callsign: "GIA1" },
      { alert_id: "b1", time: at("18:00:00") },
    ),
  ];

  it("numbers incidents from the oldest and puts each alert in order inside its incident", () => {
    const refs = incidentRefs(rows);
    expect(refs.get("b1")).toMatchObject({ number: 1, size: 1, position: 1 });
    expect(refs.get("a1")).toMatchObject({ number: 2, size: 2, position: 1 });
    expect(refs.get("a2")).toMatchObject({ number: 2, size: 2, position: 2 });
  });

  it("hands the incident to each normalized alert", () => {
    const grouped = groupAlertDetails(rows);
    expect(grouped.apa.find((d) => d.alertId === "a1")?.incident?.number).toBe(
      2,
    );
    expect(grouped.ria[0]?.incident?.position).toBe(2);
  });
});
