import { describe, expect, it } from "bun:test";
import {
  clearNotamProperties,
  expiredFeatures,
  isNotamExpired,
} from "./notam-expiry";

const NOW = Date.parse("2026-11-08T07:00:00Z");
const props = (to: unknown) => ({
  notamId: "A0002/26 NOTAMN",
  notamStatus: "RESTRICTED",
  notamEffectiveTo: to,
  notamQcode: "QWRC",
  restricted: true,
  status: "RESTRICTED",
  source: "NOTAM",
  name: "NP2",
});

describe("isNotamExpired", () => {
  it("is true once the end time has passed", () => {
    expect(isNotamExpired(props("2026-08-28T23:59:00.000Z"), NOW)).toBe(true);
    expect(isNotamExpired(props("2026-11-08T07:00:01.000Z"), NOW)).toBe(false);
  });

  it("never expires a NOTAM without an end time, an unreadable one, or a restriction that is not from a NOTAM", () => {
    expect(isNotamExpired(props(null), NOW)).toBe(false);
    expect(isNotamExpired(props("PERM"), NOW)).toBe(false);
    expect(
      isNotamExpired(
        { restricted: true, notamEffectiveTo: "2020-01-01T00:00:00Z" },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("clearNotamProperties", () => {
  it("removes the restriction and every NOTAM key, keeps the rest, and sets the status back to ACTIVE", () => {
    expect(clearNotamProperties(props("2026-08-28T23:59:00.000Z"))).toEqual({
      status: "ACTIVE",
      source: "NOTAM",
      name: "NP2",
    });
  });

  it("does not add a status that was not there", () => {
    expect(
      clearNotamProperties({ notamId: "x", restricted: true, name: "A" }),
    ).toEqual({ name: "A" });
  });
});

describe("expiredFeatures", () => {
  it("picks the features whose NOTAM is over", () => {
    const rows = [
      {
        id: "a",
        airportId: "WARR",
        properties: props("2026-08-28T23:59:00.000Z"),
      },
      {
        id: "b",
        airportId: "WARR",
        properties: props("2026-12-31T00:00:00.000Z"),
      },
      { id: "c", airportId: "WARR", properties: null },
    ];
    expect(expiredFeatures(rows, NOW).map((r) => r.id)).toEqual(["a"]);
  });
});
