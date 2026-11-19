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

describe("ghost filter: echoes of an identity-less target that is itself established", () => {
  const anon = (id: string, north: number, east: number, over = {}) =>
    track({ trackId: id, icao24: id, north, east, ...over });

  /** Target tanpa identitas "r1-1-100" sampai mapan (cukup laporan dan sudah tampil). */
  function establish(
    filter: ReturnType<typeof createGhostFilter>,
    c: ReturnType<typeof clock>,
    reports: number,
  ): void {
    for (let i = 0; i < reports; i++) {
      filter.check(anon("r1-1-100", 300, 0));
      c.advance(100);
    }
  }

  it("holds a young identity-less target that sticks to an established one", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 3,
      establishedReports: 10,
    });
    establish(filter, c, 12);
    expect(filter.check(anon("r1-1-100", 300, 0)).action).toBe("pass");
    // Three echoes appear a few metres away, one after another.
    for (const [id, metres] of [
      ["r1-1-200", 6],
      ["r1-1-201", 14],
      ["r1-1-202", 25],
    ] as const) {
      for (let i = 0; i < 4; i++) {
        filter.check(anon("r1-1-100", 300, 0));
        c.advance(100);
        expect(filter.check(anon(id, 300, metres)).action).toBe("hold");
        c.advance(100);
      }
    }
    expect(filter.stats().ghostReports).toBeGreaterThanOrEqual(12);
  });

  it("retracts an echo that had already been shown once its parent turns established", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 1,
      establishedReports: 5,
    });
    // The echo shows up first (one report is enough to show), the parent is not established yet.
    expect(filter.check(anon("r1-1-300", 300, 8)).action).toBe("pass");
    establish(filter, c, 8);
    const verdict = filter.check(anon("r1-1-300", 300, 8));
    expect(verdict.action).toBe("retract");
  });

  it("does not suppress a target that has lasted establishedReports reports (two vehicles side by side)", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 3,
      establishedReports: 10,
    });
    establish(filter, c, 12);
    let last = "hold";
    for (let i = 0; i < 20; i++) {
      filter.check(anon("r1-1-100", 300, 0));
      c.advance(100);
      last = filter.check(anon("r1-1-400", 300, 15)).action;
      c.advance(100);
    }
    expect(last).toBe("pass");
  });

  it("lets two targets that start together both through (neither is the older, established one)", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 3,
      establishedReports: 10,
    });
    let a = "hold";
    let b = "hold";
    for (let i = 0; i < 6; i++) {
      a = filter.check(anon("r1-1-500", 300, 0)).action;
      b = filter.check(anon("r1-1-501", 300, 12)).action;
      c.advance(100);
    }
    expect([a, b]).toEqual(["pass", "pass"]);
  });

  it("leaves a young target alone when it is far from the established one", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 1,
      establishedReports: 10,
    });
    establish(filter, c, 12);
    expect(filter.check(anon("r1-1-600", 300, 200)).action).toBe("pass");
  });

  it("only compares with an established target of the same sensor", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 1,
      establishedReports: 10,
    });
    establish(filter, c, 12);
    expect(
      filter.check(anon("r1-1-700", 300, 5, { sac: 2, sic: 2 })).action,
    ).toBe("pass");
  });

  it("is off with establishedReports 0", () => {
    const c = clock();
    const filter = createGhostFilter({
      now: c.now,
      minReports: 1,
      establishedReports: 0,
    });
    establish(filter, c, 12);
    expect(filter.check(anon("r1-1-800", 300, 5)).action).toBe("pass");
  });
});
