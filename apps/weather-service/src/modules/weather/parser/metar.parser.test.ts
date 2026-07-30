import { describe, expect, it } from "bun:test";
import { parseMetar } from "./metar.parser";

describe("parseMetar", () => {
  it("parses wind, visibility, cloud layers, temp/dewpoint, and QNH", () => {
    const result = parseMetar(
      "METAR WARR 070500Z 09008KT 9000 FEW018 SCT100 30/24 Q1009 NOSIG=",
    );

    expect(result.windDirection).toBe(90);
    expect(result.windDirectionVariable).toBe(false);
    expect(result.windSpeedKt).toBe(8);
    expect(result.gustKt).toBeNull();
    expect(result.visibilityM).toBe(9000);
    expect(result.temperatureC).toBe(30);
    expect(result.dewPointC).toBe(24);
    expect(result.qnhHpa).toBe(1009);
    expect(result.clouds).toEqual([
      { cover: "FEW", baseFt: 1800 },
      { cover: "SCT", baseFt: 10000 },
    ]);
    expect(result.nosig).toBe(true);
    expect(result.cavok).toBe(false);
    expect(result.partial).toBe(false);
  });

  it("parses variable wind direction (VRB)", () => {
    const result = parseMetar(
      "METAR WARR 070500Z VRB03KT 9000 NCD 29/23 Q1008=",
    );

    expect(result.windDirectionVariable).toBe(true);
    expect(result.windDirection).toBeNull();
    expect(result.windSpeedKt).toBe(3);
  });

  it("parses gust speed", () => {
    const result = parseMetar(
      "METAR WARR 070500Z 25015G25KT 9000 BKN015 28/22 Q1006=",
    );

    expect(result.windSpeedKt).toBe(15);
    expect(result.gustKt).toBe(25);
  });

  it("treats CAVOK as visibility 9999 and sets the cavok flag", () => {
    const result = parseMetar("METAR WARR 070500Z 09006KT CAVOK 31/23 Q1010=");

    expect(result.cavok).toBe(true);
    expect(result.visibilityM).toBe(9999);
  });

  it("detects negative temperature and dew point (M-prefixed)", () => {
    const result = parseMetar(
      "METAR WARR 070500Z 36010KT 9999 SCT020 M02/M05 Q1020=",
    );

    expect(result.temperatureC).toBe(-2);
    expect(result.dewPointC).toBe(-5);
  });

  it("falls back to the altimeter (A-code) for QNH when no Q-code is present", () => {
    const result = parseMetar(
      "METAR WARR 070500Z 09008KT 9000 FEW018 30/24 A2982=",
    );

    // 29.82 inHg -> hPa, rounded: 29.82 * 33.8639 ~= 1009.8 -> 1010
    expect(result.qnhHpa).toBe(1010);
  });

  it("detects RVR presence and extracts weather phenomena, without letting the RVR group override visibility", () => {
    const result = parseMetar(
      "METAR WARR 070500Z 09006KT 0400 R09/0600 FG 22/22 Q1015=",
    );

    expect(result.hasRvr).toBe(true);
    expect(result.visibilityM).toBe(400);
    expect(result.phenomena).toContain("FG");
  });

  it("is marked partial when the wind group is missing", () => {
    const result = parseMetar("METAR WARR 070500Z 9000 FEW018 30/24 Q1009=");

    expect(result.partial).toBe(true);
  });

  it("is marked partial when neither CAVOK nor a visibility group is present", () => {
    const result = parseMetar("METAR WARR 070500Z 09008KT FEW018 30/24 Q1009=");

    expect(result.visibilityM).toBeNull();
    expect(result.partial).toBe(true);
  });

  it("is not partial for a complete report even without explicit cloud/phenomena groups", () => {
    const result = parseMetar("METAR WARR 070500Z 09008KT CAVOK 30/24 Q1009=");

    expect(result.partial).toBe(false);
  });

  it("ignores the RMK section", () => {
    const result = parseMetar(
      "METAR WARR 070500Z 09008KT 9000 FEW018 30/24 Q1009 RMK A2982 SLP134=",
    );

    // The RMK-only altimeter (A2982) must not leak into qnhHpa since a
    // Q-code was already present before RMK.
    expect(result.qnhHpa).toBe(1009);
  });
});
