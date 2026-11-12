import { describe, expect, it } from "bun:test";
import { createGhostFilter, isSyntheticId } from "./ghost-filter";
import { clock, track } from "./test-support";

const sjy = (north: number, east: number) =>
  track({
    trackId: "ast_sjy",
    icao24: "8a06b3",
    callsign: "SJY567",
    north,
    east,
  });
const ghost = (north: number, east: number, over = {}) =>
  track({ trackId: "ast_ghost", icao24: "r1-1-278", north, east, ...over });

describe("isSyntheticId", () => {
  it("recognises ids built from a sensor track number, and a missing identity", () => {
    for (const id of ["r1-1-278", "v50-176-42", "t1-1-9"])
      expect(isSyntheticId(id)).toBe(true);
    expect(isSyntheticId("8a06b3")).toBe(false);
    expect(isSyntheticId(undefined)).toBe(true);
  });
});

describe("ghost filter", () => {
  it("never lets through the echo of SJY567 seen on 12 Nov 2026 (7 reports, 4.5 to 37 m from the aircraft, same MLAT)", () => {
    const c = clock();
    const filter = createGhostFilter({ now: c.now });
    // Distances measured in aeroswarm_tracks for ast_LHtfIFC9YCTF against SJY567 at the same second.
    for (const metres of [14.8, 37.4, 8.0, 4.5, 13.6, 22.1, 14.4]) {
      expect(filter.check(sjy(0, 0)).action).toBe("pass");
      c.advance(100);
      expect(filter.check(ghost(metres, 0)).action).toBe("hold");
      c.advance(900);
    }
    expect(filter.stats().ghostReports).toBe(7);
  });

  it("holds a new identity-less target for minReports reports, then lets it through", () => {
    const c = clock();
    const filter = createGhostFilter({ now: c.now, minReports: 3 });
    const far = (n: number) => ghost(300, n);
    expect(filter.check(far(0))).toEqual({ action: "hold", reason: "baru" });
    expect(filter.check(far(1))).toEqual({ action: "hold", reason: "baru" });
    expect(filter.check(far(2))).toEqual({ action: "pass" });
    expect(filter.check(far(3))).toEqual({ action: "pass" });
  });

  it("only compares with an identified target of the same sensor", () => {
    const c = clock();
    const filter = createGhostFilter({ now: c.now, minReports: 1 });
    filter.check(sjy(0, 0));
    // Same place, but another sensor (a radar, not the MLAT): not an echo of that MLAT target.
    expect(
      filter.check(ghost(5, 0, { protocol: "asterix-cat048", sac: 5, sic: 9 }))
        .action,
    ).toBe("pass");
    // Same protocol but another system (SAC/SIC): not the same sensor either.
    const other = createGhostFilter({ now: c.now, minReports: 1 });
    other.check(sjy(0, 0));
    expect(other.check(ghost(5, 0, { sac: 2, sic: 2 })).action).toBe("pass");
  });

  it("ignores an identified report that is older than maxAgeMs", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 1,
      maxAgeMs: 2000,
    });
    filter.check(sjy(0, 0));
    c.advance(2500);
    expect(filter.check(ghost(5, 0)).action).toBe("pass");
  });

  it("does not take a target 100 m away for an echo", () => {
    const c = clock();
    const filter = createGhostFilter({ now: c.now, minReports: 1 });
    filter.check(sjy(0, 0));
    expect(filter.check(ghost(100, 0)).action).toBe("pass");
  });

  it("retracts, once, a target that was shown and then turns out to sit on an aircraft, and releases it after it moves away", () => {
    const c = clock();
    const filter = createGhostFilter({ now: c.now, minReports: 2 });
    filter.check(ghost(300, 0));
    expect(filter.check(ghost(300, 1)).action).toBe("pass");
    filter.check(sjy(0, 0));
    expect(filter.check(ghost(5, 0)).action).toBe("retract");
    expect(filter.check(ghost(6, 0))).toEqual({
      action: "hold",
      reason: "bayangan",
    });
    // Leaves the aircraft: held for minReports far reports, then back.
    expect(filter.check(ghost(300, 2))).toEqual({
      action: "hold",
      reason: "bayangan",
    });
    expect(filter.check(ghost(300, 3)).action).toBe("pass");
    expect(filter.stats().retracted).toBe(1);
  });

  it("passes a drop for a target that was shown and swallows one for a target that never was", () => {
    const c = clock();
    const filter = createGhostFilter({ now: c.now, minReports: 1 });
    filter.check(ghost(300, 0));
    expect(filter.check(ghost(300, 0, { lifecycle: "dropped" })).action).toBe(
      "pass",
    );
    const never = createGhostFilter({ now: c.now, minReports: 3 });
    never.check(ghost(300, 0));
    expect(never.check(ghost(300, 0, { lifecycle: "dropped" })).action).toBe(
      "hold",
    );
  });

  it("never touches an identified target", () => {
    const filter = createGhostFilter({ now: clock().now });
    expect(filter.check(sjy(0, 0))).toEqual({ action: "pass" });
  });

  it("forgets targets that stopped reporting", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 2,
      forgetAfterMs: 1000,
    });
    filter.check(ghost(300, 0));
    c.advance(5000);
    filter.sweep();
    // State gone: counts as a new target again.
    expect(filter.check(ghost(300, 1)).action).toBe("hold");
  });
});
