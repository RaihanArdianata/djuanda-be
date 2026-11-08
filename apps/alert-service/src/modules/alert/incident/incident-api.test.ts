import { describe, expect, it } from "bun:test";
import { resolveRange } from "../service/incident.service";
import {
  listIncidentsSchema,
  verifyIncidentsSchema,
} from "../validator/alert.validator";

const NOW = Date.parse("2026-11-08T12:00:00Z");
const DAY = 86_400_000;

describe("resolveRange", () => {
  it("defaults to the last 30 days", () => {
    const { start, end } = resolveRange(undefined, undefined, NOW);
    expect(end.getTime()).toBe(NOW);
    expect(end.getTime() - start.getTime()).toBe(30 * DAY);
  });

  it("never reaches further back than 120 days", () => {
    const { start, end } = resolveRange(
      new Date(NOW - 400 * DAY),
      new Date(NOW),
      NOW,
    );
    expect(end.getTime() - start.getTime()).toBe(120 * DAY);
  });

  it("keeps a range the caller chose when it is short enough", () => {
    const wanted = new Date(NOW - 10 * DAY);
    expect(resolveRange(wanted, undefined, NOW).start.getTime()).toBe(
      wanted.getTime(),
    );
  });
});

describe("verifyIncidentsSchema", () => {
  const base = { alertIds: ["a", "b"] };

  it("accepts a verified incident with nothing else", () => {
    expect(
      verifyIncidentsSchema.safeParse({ ...base, status: "VERIFIED" }).success,
    ).toBe(true);
  });

  it("requires a reason or a note for a false alarm", () => {
    expect(
      verifyIncidentsSchema.safeParse({ ...base, status: "FALSE_ALARM" })
        .success,
    ).toBe(false);
    expect(
      verifyIncidentsSchema.safeParse({
        ...base,
        status: "FALSE_ALARM",
        reasonCode: "RADAR_NOISE",
      }).success,
    ).toBe(true);
    expect(
      verifyIncidentsSchema.safeParse({
        ...base,
        status: "FALSE_ALARM",
        note: "kendaraan survei berizin",
      }).success,
    ).toBe(true);
  });

  it("requires a note when the reason is Other", () => {
    const other = { ...base, status: "FALSE_ALARM", reasonCode: "OTHER" };
    expect(verifyIncidentsSchema.safeParse(other).success).toBe(false);
    expect(
      verifyIncidentsSchema.safeParse({ ...other, note: "kendaraan survei" })
        .success,
    ).toBe(true);
  });

  it("cannot be used to set an alert back to unverified, and needs at least one alert", () => {
    expect(
      verifyIncidentsSchema.safeParse({ ...base, status: "UNVERIFIED" })
        .success,
    ).toBe(false);
    expect(
      verifyIncidentsSchema.safeParse({ alertIds: [], status: "VERIFIED" })
        .success,
    ).toBe(false);
  });

  it("does not confirm critical and does not skip judged alerts unless asked", () => {
    const parsed = verifyIncidentsSchema.parse({ ...base, status: "VERIFIED" });
    expect(parsed.confirmCritical).toBe(false);
    expect(parsed.onlyUnverified).toBe(false);
  });
});

describe("listIncidentsSchema", () => {
  it("reads the page, the limit and the filters from the query", () => {
    const parsed = listIncidentsSchema.parse({
      page: "2",
      limit: "50",
      verification: "NEEDS_ACTION",
      severity: "CRITICAL",
    });
    expect(parsed.page).toBe(2);
    expect(parsed.limit).toBe(50);
    expect(parsed.verification).toBe("NEEDS_ACTION");
  });

  it("refuses a page size above 100", () => {
    expect(listIncidentsSchema.safeParse({ limit: "500" }).success).toBe(false);
  });
});
