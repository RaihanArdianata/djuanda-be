import { describe, expect, it } from "bun:test";
import { parseTaf } from "./taf.parser";

describe("parseTaf", () => {
  it("parses the base period and an FM change group", () => {
    const result = parseTaf(
      "TAF WARR 070500Z 0706/0812 09008KT 9000 SCT018 FM071200 25012KT CAVOK",
      [
        { timeFrom: 1_700_000_000, timeTo: 1_700_010_000 },
        { timeFrom: 1_700_010_000, timeTo: 1_700_020_000 },
      ],
    );

    expect(result.partial).toBe(false);
    expect(result.periods).toHaveLength(2);

    const [base, fm] = result.periods;
    expect(base?.changeType).toBeNull();
    expect(base?.windDirection).toBe(90);
    expect(base?.windSpeedKt).toBe(8);
    expect(base?.visibilityM).toBe(9000);
    expect(base?.clouds).toEqual([{ cover: "SCT", baseFt: 1800 }]);

    expect(fm?.changeType).toBe("FM");
    expect(fm?.probability).toBeNull();
    expect(fm?.windDirection).toBe(250);
    expect(fm?.windSpeedKt).toBe(12);
    expect(fm?.visibilityM).toBe(9999); // CAVOK
  });

  it("parses a BECMG group with wind and gust", () => {
    const result = parseTaf(
      "TAF WARR 070500Z 0706/0812 09008KT 9999 SCT018 BECMG 0708/0710 25015G28KT 9999 BKN020",
      [
        { timeFrom: 1, timeTo: 2 },
        { timeFrom: 3, timeTo: 4 },
      ],
    );

    const becmg = result.periods[1];
    expect(becmg?.changeType).toBe("BECMG");
    expect(becmg?.windDirection).toBe(250);
    expect(becmg?.windSpeedKt).toBe(15);
    expect(becmg?.gustKt).toBe(28);
    expect(becmg?.clouds).toEqual([{ cover: "BKN", baseFt: 2000 }]);
  });

  it("parses a TEMPO group with weather phenomena and cloud layer", () => {
    const result = parseTaf(
      "TAF WARR 070500Z 0706/0812 09008KT 9999 NSC TEMPO 0712/0716 4000 TSRA BKN008",
      [
        { timeFrom: 1, timeTo: 2 },
        { timeFrom: 3, timeTo: 4 },
      ],
    );

    const tempo = result.periods[1];
    expect(tempo?.changeType).toBe("TEMPO");
    expect(tempo?.probability).toBeNull();
    expect(tempo?.visibilityM).toBe(4000);
    expect(tempo?.weather).toEqual(["TSRA"]);
    expect(tempo?.clouds).toEqual([{ cover: "BKN", baseFt: 800 }]);
  });

  it("parses PROB30 and PROB40 groups with their probability values", () => {
    const result = parseTaf(
      "TAF WARR 070500Z 0706/0812 09008KT 9999 NSC PROB30 0710/0714 3000 BR PROB40 0716/0720 1500 FG",
      [
        { timeFrom: 1, timeTo: 2 },
        { timeFrom: 3, timeTo: 4 },
        { timeFrom: 5, timeTo: 6 },
      ],
    );

    const [, prob30, prob40] = result.periods;
    expect(prob30?.changeType).toBe("PROB");
    expect(prob30?.probability).toBe(30);
    expect(prob30?.visibilityM).toBe(3000);
    expect(prob30?.weather).toEqual(["BR"]);

    expect(prob40?.changeType).toBe("PROB");
    expect(prob40?.probability).toBe(40);
    expect(prob40?.visibilityM).toBe(1500);
    expect(prob40?.weather).toEqual(["FG"]);
  });

  it("treats CAVOK as visibility 9999 within a change group", () => {
    const result = parseTaf(
      "TAF WARR 070500Z 0706/0812 09008KT 9999 NSC BECMG 0708/0710 12006KT CAVOK",
      [
        { timeFrom: 1, timeTo: 2 },
        { timeFrom: 3, timeTo: 4 },
      ],
    );

    expect(result.periods[1]?.visibilityM).toBe(9999);
  });

  it("parses a standalone variable wind direction group (dddVddd) alongside a mean wind vector", () => {
    const result = parseTaf(
      "TAF WARR 070500Z 0706/0812 09010KT 090V150 9999 NSC",
      [{ timeFrom: 1, timeTo: 2 }],
    );

    const period = result.periods[0];
    expect(period?.windDirection).toBe(90);
    expect(period?.windSpeedKt).toBe(10);
    expect(period?.windDirectionVariable).toBe(true);
  });

  it("extracts the real visibility group instead of the segment's own ddHH/ddHH validity range (regression)", () => {
    const result = parseTaf("TAF WARR 070500Z 0706/0812 09008KT 9000 SCT018", [
      { timeFrom: 1, timeTo: 2 },
    ]);

    // Before the fix, VISIBILITY_RE matched "0706" out of the leading
    // "0706/0812" validity range instead of the real "9000" visibility group.
    expect(result.periods[0]?.visibilityM).toBe(9000);
    expect(result.periods[0]?.visibilityM).not.toBe(706);
  });

  it("is marked partial when the segment count doesn't match the provider's forecast period count", () => {
    const result = parseTaf(
      "TAF WARR 070500Z 0706/0812 09008KT 9000 SCT018 FM071200 25012KT CAVOK",
      // Only one fcst entry even though the raw text has two segments (base + FM).
      [{ timeFrom: 1, timeTo: 2 }],
    );

    expect(result.partial).toBe(true);
    expect(result.periods).toHaveLength(1);
  });
});
