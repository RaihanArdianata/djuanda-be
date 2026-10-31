import { describe, expect, it } from "bun:test";
import {
  Accumulator,
  DEFAULT_THRESHOLDS,
  diffMaps,
  distanceM,
  formatReport,
  keyOf,
  type LiveTrack,
  percentile,
  type TrackMap,
  verdict,
} from "./compare-live";

const t = (over: Partial<LiveTrack> = {}): LiveTrack => ({
  trackId: "x",
  icao24: "8a0f21",
  callsign: "GIA123",
  lat: -7.38,
  lon: 112.78,
  status: "active",
  lastSeenAt: 1_000_000,
  ...over,
});
const mapOf = (...tracks: LiveTrack[]): TrackMap =>
  new Map(tracks.map((x) => [keyOf(x), x]));

describe("keyOf", () => {
  it("prefers icao24, then callsign, then track id, ignoring case", () => {
    expect(keyOf(t({ icao24: "8A0F21" }))).toBe("8a0f21");
    expect(keyOf(t({ icao24: null, callsign: "gia123" }))).toBe("GIA123");
    expect(keyOf(t({ icao24: null, callsign: null, trackId: "t9" }))).toBe(
      "t9",
    );
  });
});

describe("distanceM", () => {
  it("is zero for identical points and about 111 km per degree of latitude", () => {
    expect(distanceM({ lat: 1, lon: 1 }, { lat: 1, lon: 1 })).toBe(0);
    const d = distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });
});

describe("percentile", () => {
  it("handles empty, single and ordered lists", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
  });
});

describe("diffMaps", () => {
  it("separates aircraft present in only one system", () => {
    const d = diffMaps(
      mapOf(t({ icao24: "a" }), t({ icao24: "b" })),
      mapOf(t({ icao24: "b" }), t({ icao24: "c" })),
    );
    expect(d.onlyA).toEqual(["a"]);
    expect(d.onlyB).toEqual(["c"]);
    expect(d.both).toBe(1);
  });

  it("measures position, status and phase differences for shared aircraft", () => {
    const d = diffMaps(
      mapOf(
        t({ lat: -7.38, status: "active", flightPlan: { phase: "DEPARTURE" } }),
      ),
      mapOf(
        t({ lat: -7.3801, status: "stale", flightPlan: { phase: "ARRIVAL" } }),
      ),
    );
    expect(d.distancesM[0]).toBeGreaterThan(10);
    expect(d.distancesM[0]).toBeLessThan(12);
    expect(d.statusMismatch).toEqual(["8a0f21"]);
    expect(d.phaseMismatch).toEqual(["8a0f21"]);
  });

  it("treats a missing flight plan as NONE on both sides", () => {
    const d = diffMaps(
      mapOf(t()),
      mapOf(t({ flightPlan: { phase: "DEPARTURE" } })),
    );
    expect(d.phaseMismatch).toEqual(["8a0f21"]);
    expect(diffMaps(mapOf(t()), mapOf(t())).phaseMismatch).toEqual([]);
  });

  it("does not compare position or status across reports too far apart in time", () => {
    const d = diffMaps(
      mapOf(t({ lastSeenAt: 1_000_000, lat: 0 })),
      mapOf(t({ lastSeenAt: 1_060_000, lat: 5, status: "lost" })),
    );
    expect(d.distancesM).toEqual([]);
    expect(d.statusMismatch).toEqual([]);
  });

  it("skips distance when a position is missing", () => {
    const d = diffMaps(mapOf(t({ lat: null })), mapOf(t()));
    expect(d.distancesM).toEqual([]);
    expect(d.both).toBe(1);
  });
});

describe("Accumulator and verdict", () => {
  const identical = (): ReturnType<typeof diffMaps> =>
    diffMaps(
      mapOf(t({ icao24: "a" }), t({ icao24: "b" })),
      mapOf(t({ icao24: "a" }), t({ icao24: "b" })),
    );

  it("passes when the two systems agree", () => {
    const acc = new Accumulator();
    for (let i = 0; i < 10; i++) acc.add(identical());
    const r = acc.report();
    expect(r).toMatchObject({
      samples: 10,
      avgA: 2,
      avgB: 2,
      avgBoth: 2,
      onlyOneRate: 0,
    });
    expect(verdict(r)).toEqual({ ok: true, failures: [] });
  });

  it("fails on missing aircraft, naming which side lacked them", () => {
    const acc = new Accumulator();
    for (let i = 0; i < 10; i++) {
      acc.add(
        diffMaps(
          mapOf(t({ icao24: "a" }), t({ icao24: "ghost" })),
          mapOf(t({ icao24: "a" })),
        ),
      );
    }
    const r = acc.report();
    expect(r.onlyOneRate).toBeCloseTo(0.5, 5);
    expect(r.topOnlyA[0]).toEqual(["ghost", 10]);
    const v = verdict(r);
    expect(v.ok).toBe(false);
    expect(v.failures[0]).toContain("only one system");
  });

  it("fails on position drift and on phase disagreement", () => {
    const acc = new Accumulator();
    acc.add(
      diffMaps(
        mapOf(t({ lat: -7.38, flightPlan: { phase: "DEPARTURE" } })),
        mapOf(t({ lat: -7.39, flightPlan: { phase: "ARRIVAL" } })),
      ),
    );
    const v = verdict(acc.report());
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => f.includes("position p95"))).toBe(true);
    expect(v.failures.some((f) => f.includes("phase mismatch"))).toBe(true);
  });

  it("fails when nothing was sampled, instead of passing vacuously", () => {
    expect(verdict(new Accumulator().report()).ok).toBe(false);
  });

  it("honours custom thresholds", () => {
    const acc = new Accumulator();
    acc.add(diffMaps(mapOf(t({ icao24: "a" })), mapOf(t({ icao24: "b" }))));
    expect(
      verdict(acc.report(), { ...DEFAULT_THRESHOLDS, maxOnlyOneRate: 1 }).ok,
    ).toBe(true);
  });

  it("formats a readable report", () => {
    const acc = new Accumulator();
    acc.add(identical());
    const text = formatReport(acc.report());
    expect(text).toContain("samples");
    expect(text).toContain("position diff");
  });
});
