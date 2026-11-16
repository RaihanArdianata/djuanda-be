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

/** Jalankan satu target sepanjang `steps` laporan 1 detik; `reportFor(i)` memberi laporan ke-i. */
function run(
  steps: number,
  reportFor: (i: number) => ReturnType<typeof at>,
  opts = {},
) {
  const c = clock();
  const stab = createTrackStabilizer({ now: c.now, ...opts });
  const outs: Array<ReturnType<typeof stab.apply>> = [];
  for (let i = 0; i < steps; i++) {
    outs.push(stab.apply(reportFor(i)));
    c.advance(1000);
  }
  return { stab, outs };
}

describe("track stabilizer: standing", () => {
  it("turns a standing aircraft's 1 to 7 m scribble into one point with a steady heading", () => {
    const { outs } = run(30, (i) => {
      const [n, e] = JITTER[i % JITTER.length] as [number, number];
      // The sensor reports a random heading and 0 to 2 kt for a target that is not moving.
      return at(n, e, i % 3, (i * 97) % 360);
    });
    const first = posOf(outs[0] as never);
    for (const o of outs.slice(1)) {
      expect(distanceM(posOf(o), first)).toBeLessThan(0.01);
      expect(o.velocity?.groundSpeed).toBe(0);
    }
    const headings = new Set(outs.slice(1).map((o) => o.velocity?.heading));
    expect(headings.size).toBe(1);
  });

  it("is not moved by a single 44 m jump, nor by a noisy speed reading", () => {
    const { outs } = run(12, (i) =>
      i === 8 ? at(44, 0, 3) : at(0, 0, i === 9 ? 5 : 1),
    );
    const first = posOf(outs[0] as never);
    for (const o of outs) expect(distanceM(posOf(o), first)).toBeLessThan(0.01);
  });
});

describe("track stabilizer: moving smoothly", () => {
  it("never makes a step bigger than the aircraft's own speed allows, also when it starts moving after standing (no stair-steps)", () => {
    // Stands 10 s, then taxis east at 10 kt (5.1 m/s) for 20 s.
    const { outs } = run(30, (i) =>
      i < 10 ? at(0, 0, 0) : at(0, (i - 10) * 5.1, 10, 90),
    );
    let previous = posOf(outs[0] as never);
    for (const o of outs.slice(1)) {
      const here = posOf(o);
      // Allowed step: max(speed, 6 kt) x 1.5 over one second, which is below 6 m here.
      expect(distanceM(previous, here)).toBeLessThan(6);
      previous = here;
    }
    // Once it moves steadily it is shown close to where the sensor has it.
    const last = outs[outs.length - 1] as never;
    expect(distanceM(posOf(last), offset(0, 19 * 5.1))).toBeLessThan(8);
  });

  it("keeps the heading of a straight taxi steady despite 2 m of noise and a heading the sensor gets wrong", () => {
    const { outs } = run(25, (i) => {
      const [nn, ee] = JITTER[i % JITTER.length] as [number, number];
      return at(nn * 0.4, i * 7.7 + ee * 0.4, 15, (i * 131) % 360);
    });
    for (const o of outs.slice(4))
      expect(angleDiff(o.velocity?.heading ?? Number.NaN, 90)).toBeLessThan(20);
  });

  it("follows a slow creep (3 kt, e.g. a pushback) without standing still for good", () => {
    // 3 kt = 1.5 m/s due north for 60 s, with noise: the shown position keeps up within the dead zone.
    const { outs } = run(60, (i) => {
      const [nn, ee] = JITTER[i % JITTER.length] as [number, number];
      return at(i * 1.5 + nn * 0.3, ee * 0.3, 3, 0);
    });
    const last = posOf(outs[outs.length - 1] as never);
    const truth = offset(59 * 1.5, 0);
    expect(distanceM(last, truth)).toBeLessThan(20);
    expect(distanceM(last, offset(0, 0))).toBeGreaterThan(60);
  });

  it("does not take an aircraft rolling at 120 kt on the runway for a jump", () => {
    // 120 kt is 61.7 m/s; with the old fixed limit of 80 kt every second report would have been rejected.
    const { stab, outs } = run(10, (i) => at(0, i * 61.7, 120, 90));
    expect(stab.stats().jumpsRejected).toBe(0);
    expect(
      distanceM(posOf(outs[9] as never), offset(0, 9 * 61.7)),
    ).toBeLessThan(5);
  });
});

describe("track stabilizer: jumps", () => {
  it("rejects a jump that no aircraft could make, but accepts it if it persists", () => {
    const { stab, outs } = run(10, (i) =>
      i < 6 ? at(0, i * 7.7, 15, 90) : at(0, 340 + (i - 6) * 7.7, 15, 90),
    );
    const before = posOf(outs[5] as never);
    // The first two reports after the jump stay where the aircraft was ...
    expect(distanceM(posOf(outs[6] as never), before)).toBeLessThan(1);
    expect(distanceM(posOf(outs[7] as never), before)).toBeLessThan(1);
    expect(stab.stats().jumpsRejected).toBe(2);
    // ... and then it is real: the shown position goes after it at the pace the aircraft's own speed allows (3 s went by, at 15 kt
    // that is about 35 m), not in one leap of 340 m.
    const target = offset(0, 340 + 3 * 7.7);
    let previous = before;
    for (let i = 8; i < 10; i++) {
      const here = posOf(outs[i] as never);
      expect(distanceM(previous, here)).toBeLessThan(40);
      expect(distanceM(here, target)).toBeLessThan(distanceM(previous, target));
      previous = here;
    }
  });
});

describe("track stabilizer: airborne outliers (GIA349, 16 Nov 2026)", () => {
  // Kecepatan pesawat sekitar 200 kt = 103 m/s ke timur; satu laporan per detik.
  const air = (north: number, east: number, gs = 200) =>
    at(north, east, gs, 100, { onGround: false });

  it("keeps a single report 38 km away (another sensor track number with the same Mode-S) out of the track, and carries on normally", () => {
    // Datanya: tn=3892 dilaporkan normal, satu laporan tn=1063 melompat 38 km dalam 1 detik, lalu kembali ke tn=3892.
    const { stab, outs } = run(8, (i) =>
      i === 4 ? air(18_200, 33_800) : air(0, i * 103),
    );
    const before = posOf(outs[3] as never);
    // The spike is not shown: the position stays where the aircraft was.
    expect(distanceM(posOf(outs[4] as never), before)).toBeLessThan(1);
    // The report after it is accepted at once and is where the aircraft really is.
    expect(distanceM(posOf(outs[5] as never), offset(0, 5 * 103))).toBeLessThan(
      1,
    );
    // No long out-and-back line: no step between two shown positions is more than a normal second of flight plus a little.
    for (let i = 1; i < outs.length; i++) {
      expect(
        distanceM(posOf(outs[i - 1] as never), posOf(outs[i] as never)),
      ).toBeLessThan(220);
    }
    expect(stab.stats().jumpsRejected).toBe(1);
  });

  it("also rejects the 5.6 km out-and-back seen at 09:53:17 (tn=666)", () => {
    const { stab, outs } = run(6, (i) =>
      i === 3 ? air(-5_600, i * 103) : air(0, i * 103, 106),
    );
    expect(
      distanceM(posOf(outs[3] as never), posOf(outs[2] as never)),
    ).toBeLessThan(1);
    expect(distanceM(posOf(outs[4] as never), offset(0, 4 * 103))).toBeLessThan(
      1,
    );
    expect(stab.stats().jumpsRejected).toBe(1);
  });

  it("passes the airborne reports it accepts through untouched, heading and speed included", () => {
    const { outs } = run(5, (i) => air(0, i * 103));
    for (let i = 0; i < outs.length; i++) {
      expect(
        distanceM(posOf(outs[i] as never), offset(0, i * 103)),
      ).toBeLessThan(0.01);
      expect(outs[i]?.velocity?.groundSpeed).toBe(200);
      expect(outs[i]?.velocity?.heading).toBe(100);
    }
  });

  it("does not take a 10 km move after a 68 s gap in reports (290 kt) for a jump", () => {
    const c = clock();
    const stab = createTrackStabilizer({ now: c.now });
    stab.apply(air(0, 0, 250));
    c.advance(68_600);
    const out = stab.apply(air(0, 10_245, 250));
    expect(distanceM(posOf(out), offset(0, 10_245))).toBeLessThan(0.01);
    expect(stab.stats().jumpsRejected).toBe(0);
  });

  it("believes a move that persists: the third report in a row at the new place is accepted", () => {
    const { stab, outs } = run(6, (i) =>
      i < 3 ? air(0, i * 103) : air(50_000, 50_000 + i * 103),
    );
    expect(
      distanceM(posOf(outs[3] as never), posOf(outs[2] as never)),
    ).toBeLessThan(1);
    expect(
      distanceM(posOf(outs[4] as never), posOf(outs[2] as never)),
    ).toBeLessThan(1);
    expect(
      distanceM(posOf(outs[5] as never), offset(50_000, 50_000 + 5 * 103)),
    ).toBeLessThan(1);
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
    // A new life of the same id starts where it is reported, not at the old place.
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
