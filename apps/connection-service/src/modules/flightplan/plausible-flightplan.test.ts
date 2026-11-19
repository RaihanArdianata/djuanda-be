import { describe, expect, it } from "bun:test";
import type { FlightPlanEvent } from "@aeroswarm/core";
import { isPlausibleFlightPlan } from "./plausible-flightplan";

const plan = (callsign: string, text: string): FlightPlanEvent =>
  ({
    messageId: "m1",
    sourceId: "test",
    receivedAt: 1,
    message: { type: "FPL", header: { addressees: [] }, text, callsign },
  }) as unknown as FlightPlanEvent;

describe("isPlausibleFlightPlan", () => {
  it("accepts a real flight plan", () => {
    const text =
      "(FPL-GIA303-IS-B738/M-SDE1E3FGHIRWY/LB1-WARR1030-N0450F340 BLI DCT-WIII0125-PBN/A1B1C1D1O1S2 DOF/261119 REG/PKGFA)";
    expect(isPlausibleFlightPlan(plan("GIA303", text)).ok).toBe(true);
  });

  it("rejects random bytes that happen to look like a message (seen on the radar port)", () => {
    const junk = plan(
      ":5#TBKI<VO[>ZDET?+|OW0 ESBVO S",
      "(SSU-:5#TBki<vO[>zdET?+|OW0 esBVo s)",
    );
    const v = isPlausibleFlightPlan(junk);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("callsign");
  });

  it("rejects a callsign that is empty, too long or has symbols", () => {
    for (const cs of ["", "A", "TOOLONGCS1", "GIA-303", "gia 303"])
      expect(isPlausibleFlightPlan(plan(cs, "(FPL-X)")).ok).toBe(false);
  });

  it("rejects a text with characters outside the AFTN set even if the callsign looks fine", () => {
    const v = isPlausibleFlightPlan(plan("GIA303", "(FPL-GIA303-IS\u0001ÿ)"));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("karakter");
  });
});
