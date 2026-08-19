import { describe, expect, it } from "bun:test";
import { resolveIncrementalWindow } from "./aftn.service";

describe("resolveIncrementalWindow", () => {
  const now = new Date("2026-05-30T12:00:00.000Z");
  const intervalMs = 30 * 60 * 1000;
  const overlapMs = 5 * 60 * 1000;

  it("uses latest stored datetime minus overlap when a watermark exists", () => {
    const latest = new Date(now.getTime() - intervalMs);
    const { startDate, endDate } = resolveIncrementalWindow(
      latest,
      now,
      intervalMs,
      overlapMs,
    );

    expect(startDate.toISOString()).toBe("2026-05-30T11:25:00.000Z");
    expect(endDate.toISOString()).toBe(now.toISOString());
  });

  it("falls back to one full interval before now when nothing is stored", () => {
    const { startDate, endDate } = resolveIncrementalWindow(
      null,
      now,
      intervalMs,
      overlapMs,
    );

    expect(startDate.toISOString()).toBe("2026-05-30T11:25:00.000Z");
    expect(endDate.toISOString()).toBe(now.toISOString());
  });

  it("never starts later than one full interval before now", () => {
    const latest = new Date(now.getTime() - 60_000);
    const { startDate } = resolveIncrementalWindow(
      latest,
      now,
      intervalMs,
      overlapMs,
    );

    expect(startDate.getTime()).toBeLessThanOrEqual(now.getTime() - intervalMs);
  });
});
