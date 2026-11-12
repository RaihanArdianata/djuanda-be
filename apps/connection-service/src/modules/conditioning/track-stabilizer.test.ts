import { describe, expect, it } from "bun:test";
import { angleDiff, distanceM } from "./geo";
import { clock, offset, track } from "./test-support";
import { createTrackStabilizer } from "./track-stabilizer";

const at = (north: number, east: number, gs: number, hdg = 0, over = {}) =>
  track({
    trackId: "ast_a",
    icao24: "8a06b3",
    north,
    east,
    groundSpeed: gs,
    heading: hdg,
    ...over,
  });

/** Derau deterministik: pola yang meniru 1 sampai 7 m dengan arah yang berganti-ganti. */
const JITTER: Array<[number, number]> = [
  [2, 1],
  [-3, 4],
  [5, -2],
  [-1, -6],
  [4, 3],
  [-6, 1],
  [1, 5],
  [-2, -4],
  [3, -3],
  [-4, 2],
];

function posOf(e: { position?: { lat: number; lon: number } }) {
  if (!e.position) throw new Error("no position");
  return { lat: e.position.lat, lon: e.position.lon };
}

describe("track stabilizer: standing", () => {
  it("turns a standing aircraft's 1 to 7 m scribble into one point with a steady heading", () => {
    const c = clock();
    const stab = createTrackStabilizer({ now: c.now });
    const outs: Array<ReturnType<typeof stab.apply>> = [];
    for (let i = 0; i < 30; i++) {
      const [n, e] = JITTER[i % JITTER.length] as [number, number];
      // The sensor reports a random heading for a target that is not moving.
      outs.push(stab.apply(at(n, e, i % 3, (i * 97) % 360)));
      c.advance(1000);
    }
    const settled = outs.slice(6);
    const first = posOf(settled[0] as never);
    for (const o of settled) {
      expect(distanceM(posOf(o), first)).toBeLessThan(0.01);
      expect(o.velocity?.groundSpeed).toBe(0);
      expect(o.velocity?.heading).toBe(
        (settled[0] as { velocity?: { heading?: number } }).velocity?.heading,
      );
    }
  });

  it("is not moved by a single 44 m jump while it stands", () => {
    const c = clock();
    const stab = createTrackStabilizer({ now: c.now });
    let anchor = { lat: 0, lon: 0 };
    for (let i = 0; i < 6; i++) {
      anchor = posOf(stab.apply(at(0, 0, 1)));
      c.advance(1000);
    }
    const jumped = stab.apply(at(44, 0, 3));
    expect(distanceM(posOf(jumped), anchor)).toBeLessThan(0.01);
    c.advance(1000);
    expect(distanceM(posOf(stab.apply(at(0, 1, 1))), anchor)).toBeLessThan(
      0.01,
    );
  });

  it("lets go once the aircraft really moves again (two reports that are fast or far)", () => {
    const c = clock();
    const stab = createTrackStabilizer({ now: c.now });
    for (let i = 0; i < 6; i++) {
      stab.apply(at(0, 0, 0));
      c.advance(1000);
    }
    const first = stab.apply(at(0, 30, 12, 90));
    expect(first.velocity?.groundSpeed).toBe(0); // one report is not enough
    c.advance(1000);
    const second = stab.apply(at(0, 36, 12, 90));
    expect(second.velocity?.groundSpeed).toBe(12);
    expect(distanceM(posOf(second), offset(0, 36))).toBeLessThan(1);
  });
});

describe("track stabilizer: moving", () => {
  it("keeps the heading of a straight taxi steady despite 2 m of noise and a heading the sensor gets wrong", () => {
    const c = clock();
    const stab = createTrackStabilizer({ now: c.now });
    const headings: number[] = [];
    for (let i = 0; i < 25; i++) {
      const [nn, ee] = JITTER[i % JITTER.length] as [number, number];
      // 15 kt (about 7.7 m/s) due east, with noise.
      const out = stab.apply(
        at(nn * 0.4, i * 7.7 + ee * 0.4, 15, (i * 131) % 360),
      );
      if (i >= 4) headings.push(out.velocity?.heading ?? NaN);
      c.advance(1000);
    }
    for (const h of headings) expect(angleDiff(h, 90)).toBeLessThan(20);
  });

  it("rejects a jump that no aircraft could make, but accepts it if it persists", () => {
    const c = clock();
    const stab = createTrackStabilizer({ now: c.now, maxRejects: 2 });
    let last = { lat: 0, lon: 0 };
    for (let i = 0; i < 6; i++) {
      last = posOf(stab.apply(at(0, i * 7.7, 15, 90)));
      c.advance(1000);
    }
    // 300 m in one second.
    expect(distanceM(posOf(stab.apply(at(0, 340, 15, 90))), last)).toBeLessThan(
      1,
    );
    c.advance(1000);
    expect(distanceM(posOf(stab.apply(at(0, 348, 15, 90))), last)).toBeLessThan(
      1,
    );
    c.advance(1000);
    // Third in a row: it is real.
    expect(
      distanceM(posOf(stab.apply(at(0, 356, 15, 90))), last),
    ).toBeGreaterThan(100);
    expect(stab.stats().jumpsRejected).toBe(2);
  });
});

describe("track stabilizer: what it leaves alone", () => {
  it("passes an airborne target through unchanged", () => {
    const stab = createTrackStabilizer({ now: clock().now });
    const e = at(10, 10, 120, 45, { onGround: false });
    expect(stab.apply(e)).toBe(e);
  });

  it("passes a drop and forgets the track", () => {
    const c = clock();
    const stab = createTrackStabilizer({ now: c.now });
    for (let i = 0; i < 6; i++) {
      stab.apply(at(0, 0, 0));
      c.advance(1000);
    }
    const drop = at(0, 0, 0, 0, { lifecycle: "dropped" });
    expect(stab.apply(drop)).toBe(drop);
    // A new life of the same id starts unfrozen: the first reports are not held at the old anchor.
    const fresh = stab.apply(at(0, 200, 0));
    expect(distanceM(posOf(fresh), offset(0, 200))).toBeLessThan(1);
  });

  it("forgets tracks that went silent", () => {
    const c = clock();
    const stab = createTrackStabilizer({ now: c.now, forgetAfterMs: 1000 });
    for (let i = 0; i < 6; i++) {
      stab.apply(at(0, 0, 0));
      c.advance(100);
    }
    c.advance(5000);
    stab.sweep();
    const fresh = stab.apply(at(0, 200, 0));
    expect(distanceM(posOf(fresh), offset(0, 200))).toBeLessThan(1);
  });
});
