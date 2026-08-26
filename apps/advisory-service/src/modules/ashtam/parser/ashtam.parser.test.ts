import { describe, expect, it } from "bun:test";
import { parseAshtamMessage } from "./ashtam.parser";
import type { AshtamSourceItem } from "./common";

const sampleItem = (
  override: Partial<AshtamSourceItem> = {},
): AshtamSourceItem => ({
  header: "\u0001NDP2513 070600 GG WRRRYAYD 070600 WRRRYNYX",
  msg_id: "ASHTAM 7836\r\n",
  affected_fir: "WAAF",
  start_datetime: "2026-05-07 05:10:00",
  end_datetime: "2026-05-08 05:10:00",
  volcano_name: "IBU 268030",
  volcano_latitude_longitude: "N0129E12738",
  colour_code: "ORANGE",
  volcanic_ash: "SFC/FL070 N0128 E12732 - N0133 E12733 - N0139\r\nE12",
  volcanic_ash_direction: "MOV SE 05KT",
  air_routes_affected: "NIL",
  air_routes_closure: "NIL",
  information_source: "HIMAWARI-9, CVGHM",
  remark: "",
  raw: "(ASHTAM 7836\r\nA)WAAF\r\nB)05070510",
  ...override,
});

describe("parseAshtamMessage — happy path", () => {
  it("normalizes msg_id into providerId and number", () => {
    const result = parseAshtamMessage(sampleItem());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.providerId).toBe("ASHTAM 7836");
    expect(result.message.number).toBe(7836);
  });

  it("maps every documented field", () => {
    const result = parseAshtamMessage(sampleItem());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.type).toBe("ASHTAM");
    expect(result.message.affectedFir).toBe("WAAF");
    expect(result.message.effectiveFrom.toISOString()).toBe(
      "2026-05-07T05:10:00.000Z",
    );
    expect(result.message.effectiveTo.toISOString()).toBe(
      "2026-05-08T05:10:00.000Z",
    );
    expect(result.message.volcanoName).toBe("IBU 268030");
    expect(result.message.volcanoCoordinates).toBe("N0129E12738");
    expect(result.message.colourCode).toBe("ORANGE");
    expect(result.message.volcanicAshDirection).toBe("MOV SE 05KT");
    expect(result.message.airRoutesAffected).toBe("NIL");
    expect(result.message.airRoutesClosure).toBe("NIL");
    expect(result.message.informationSource).toBe("HIMAWARI-9, CVGHM");
    expect(result.message.raw).toContain("ASHTAM 7836");
  });

  it("preserves NIL as content, not as a missing value", () => {
    const result = parseAshtamMessage(
      sampleItem({ air_routes_affected: "NIL" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.airRoutesAffected).toBe("NIL");
  });

  it("uppercases colour_code", () => {
    const result = parseAshtamMessage(sampleItem({ colour_code: "orange" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.colourCode).toBe("ORANGE");
  });

  it("collapses blank remark to null instead of inventing a value", () => {
    const result = parseAshtamMessage(sampleItem({ remark: "" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.remark).toBeNull();
  });

  it("does not invent a volcano name when the source omits it", () => {
    const result = parseAshtamMessage(sampleItem({ volcano_name: undefined }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.volcanoName).toBeNull();
  });
});

describe("parseAshtamMessage — validation", () => {
  it("rejects a missing msg_id", () => {
    const result = parseAshtamMessage(sampleItem({ msg_id: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("msg_id");
  });

  it("rejects a msg_id that doesn't match ASHTAM <number>", () => {
    const result = parseAshtamMessage(sampleItem({ msg_id: "NOTAM 1234" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a missing affected_fir", () => {
    const result = parseAshtamMessage(sampleItem({ affected_fir: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("affected_fir");
  });

  it("rejects an invalid start_datetime", () => {
    const result = parseAshtamMessage(
      sampleItem({ start_datetime: "not-a-date" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("start_datetime");
  });

  it("rejects a missing end_datetime", () => {
    const result = parseAshtamMessage(sampleItem({ end_datetime: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("end_datetime");
  });

  it("rejects a missing raw message", () => {
    const result = parseAshtamMessage(sampleItem({ raw: "" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("raw");
  });
});
