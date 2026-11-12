import type { FusedTrackEvent } from "@aeroswarm/core";
import {
  angleDiff,
  bearingDeg,
  distanceM,
  type LatLon,
  lerpAngle,
} from "./geo";

/**
 * Penstabil target di permukaan. Sensor MLAT melaporkan posisi pesawat yang diam atau merayap dengan derau 1 sampai 7 m dan sesekali lonjakan
 * 20 sampai 40 m, dengan arah yang acak. Digambar apa adanya, pesawat yang berdiri di apron menjadi coretan, ikonnya berputar, dan alert yang
 * dihitung dari posisi itu ikut bergoyang. Aturan di sini (kebijakan bawaan, bisa diatur lewat env):
 *
 *  - Diam: kecepatan di bawah `standKt` selama `freezeAfter` laporan berturut-turut membekukan posisi di satu titik jangkar dan menahan arah
 *    terakhir yang baik, dengan kecepatan dilaporkan 0. Satu laporan yang menyimpang (derau, lonjakan) tidak melepas pembekuan.
 *  - Bergerak lagi: pembekuan baru dilepas setelah `releaseReports` laporan berturut-turut yang lebih cepat dari `standKt` ATAU lebih jauh dari
 *    jangkar daripada `radiusM`.
 *  - Bergerak: lonjakan yang mustahil (jarak ke posisi sebelumnya melebihi `maxJumpKt`) ditolak sampai `maxRejects` kali berturut-turut, posisi
 *    dihaluskan ringan (EMA), dan arah dihitung dari gerak yang sebenarnya (bukan dari laporan sensor yang berderau), minimal `headingMinMoveM`.
 *  - Hanya target di permukaan (`onGround`). Pesawat di udara tidak disentuh.
 */

export interface StabilizerOptions {
  /** Di bawah kecepatan ini (knot) target dianggap diam. */
  standKt: number;
  /** Laporan lambat berturut-turut sebelum posisi dibekukan. */
  freezeAfter: number;
  /** Jarak dari jangkar yang masih dianggap derau, meter. */
  radiusM: number;
  /** Laporan "bergerak" berturut-turut sebelum pembekuan dilepas. */
  releaseReports: number;
  /** Langkah lebih cepat dari ini (knot) antara dua laporan dianggap lonjakan palsu di permukaan. */
  maxJumpKt: number;
  /** Berapa laporan berturut-turut yang boleh ditolak sebagai lonjakan sebelum dianggap kenyataan. */
  maxRejects: number;
  /** Bobot laporan baru pada penghalusan posisi saat bergerak (0 sampai 1; 1 = tanpa penghalusan). */
  alpha: number;
  /** Arah baru dihitung dari gerak sejauh ini, meter. */
  headingMinMoveM: number;
  /** State target yang tidak melapor sekian lama dibuang, ms. */
  forgetAfterMs: number;
  now?: () => number;
}

export const DEFAULT_STABILIZER_OPTIONS: StabilizerOptions = {
  standKt: 6,
  freezeAfter: 3,
  radiusM: 20,
  releaseReports: 2,
  maxJumpKt: 80,
  maxRejects: 2,
  alpha: 0.6,
  headingMinMoveM: 10,
  forgetAfterMs: 120_000,
};

export interface StabilizerStats {
  /** Laporan yang dikeluarkan dari titik beku. */
  frozenReports: number;
  /** Lonjakan mustahil yang ditolak. */
  jumpsRejected: number;
}

export interface TrackStabilizer {
  apply(event: FusedTrackEvent): FusedTrackEvent;
  forget(trackId: string): void;
  sweep(): void;
  stats(): StabilizerStats;
}

interface State {
  frozen: boolean;
  anchor?: LatLon;
  slowStreak: number;
  moveStreak: number;
  rejects: number;
  /** Posisi halus terakhir yang dikeluarkan, dan kapan. */
  out?: LatLon & { at: number };
  heading?: number;
  trail: LatLon[];
  lastAt: number;
}

const KT_TO_MPS: number = 0.514444;
const TRAIL_LEN: number = 10;

function withMotion(
  event: FusedTrackEvent,
  pos: LatLon,
  groundSpeed: number | undefined,
  heading: number | undefined,
): FusedTrackEvent {
  const velocity = { ...event.velocity };
  if (groundSpeed !== undefined) velocity.groundSpeed = groundSpeed;
  if (heading !== undefined) velocity.heading = heading;
  return {
    ...event,
    position: { ...event.position, lat: pos.lat, lon: pos.lon },
    velocity,
  };
}

const newState = (event: FusedTrackEvent, at: number): State => ({
  frozen: false,
  slowStreak: 0,
  moveStreak: 0,
  rejects: 0,
  trail: [],
  lastAt: at,
  heading: event.velocity?.heading,
});

export function createTrackStabilizer(
  options: Partial<StabilizerOptions> = {},
): TrackStabilizer {
  const opts: StabilizerOptions = {
    ...DEFAULT_STABILIZER_OPTIONS,
    ...Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined),
    ),
  };
  const now = options.now ?? ((): number => Date.now());
  const states = new Map<string, State>();
  const counters: StabilizerStats = { frozenReports: 0, jumpsRejected: 0 };

  /** Arah dari gerak: dari titik terlama di jejak pendek yang sudah cukup jauh; bila belum ada, arah terakhir dipertahankan. */
  function headingFrom(
    st: State,
    here: LatLon,
    fallback: number | undefined,
  ): number | undefined {
    const old = st.trail.find(
      (p) => distanceM(p, here) >= opts.headingMinMoveM,
    );
    if (!old) return st.heading ?? fallback;
    const fresh = bearingDeg(old, here);
    if (st.heading === undefined) return fresh;
    return lerpAngle(
      st.heading,
      fresh,
      angleDiff(st.heading, fresh) > 90 ? 0.8 : 0.5,
    );
  }

  /** Titik beku: derau dan lonjakan sesaat tidak menggeser apa-apa. Mengembalikan keluaran bila masih beku, null bila sudah dilepas. */
  function whileFrozen(
    event: FusedTrackEvent,
    st: State,
    raw: LatLon,
    speed: number,
  ): FusedTrackEvent | null {
    const anchor = st.anchor;
    if (!st.frozen || !anchor) return null;
    const away = distanceM(raw, anchor) > opts.radiusM || speed >= opts.standKt;
    st.moveStreak = away ? st.moveStreak + 1 : 0;
    if (st.moveStreak < opts.releaseReports) {
      counters.frozenReports++;
      return withMotion(event, anchor, 0, st.heading);
    }
    // Benar-benar bergerak lagi: mulai dari posisi sekarang, jejak lama dibuang.
    st.frozen = false;
    st.anchor = undefined;
    st.moveStreak = 0;
    st.slowStreak = 0;
    st.rejects = 0;
    st.out = undefined;
    st.trail = [];
    return null;
  }

  /** Lonjakan mustahil terhadap posisi yang baru dikeluarkan: ditolak sampai `maxRejects` kali berturut-turut. */
  function rejectJump(
    event: FusedTrackEvent,
    st: State,
    raw: LatLon,
    t: number,
  ): FusedTrackEvent | null {
    const last = st.out;
    if (!last || st.rejects >= opts.maxRejects) {
      st.rejects = 0;
      return null;
    }
    const dtS = (t - last.at) / 1000;
    const impliedKt = dtS > 0.2 ? distanceM(raw, last) / dtS / KT_TO_MPS : 0;
    if (impliedKt <= opts.maxJumpKt) {
      st.rejects = 0;
      return null;
    }
    st.rejects++;
    counters.jumpsRejected++;
    return withMotion(event, last, event.velocity?.groundSpeed, st.heading);
  }

  /** Bergerak (atau mulai diam): penghalusan ringan, pembekuan setelah cukup laporan lambat, arah dari gerak. */
  function moving(
    event: FusedTrackEvent,
    st: State,
    raw: LatLon,
    speed: number,
    t: number,
  ): FusedTrackEvent {
    const last = st.out;
    const smooth: LatLon = last
      ? {
          lat: last.lat + (raw.lat - last.lat) * opts.alpha,
          lon: last.lon + (raw.lon - last.lon) * opts.alpha,
        }
      : raw;

    st.slowStreak = speed < opts.standKt ? st.slowStreak + 1 : 0;
    if (st.slowStreak >= opts.freezeAfter) {
      st.frozen = true;
      st.anchor = smooth;
      st.moveStreak = 0;
      counters.frozenReports++;
      return withMotion(event, smooth, 0, st.heading);
    }

    const heading = headingFrom(st, smooth, event.velocity?.heading);
    st.heading = heading;
    st.out = { ...smooth, at: t };
    st.trail.push(smooth);
    if (st.trail.length > TRAIL_LEN) st.trail.shift();
    return withMotion(event, smooth, event.velocity?.groundSpeed, heading);
  }

  return {
    apply(event: FusedTrackEvent): FusedTrackEvent {
      const id = event.trackId;
      const pos = event.position;
      // Hanya target di permukaan; yang dihapus atau di udara dilepas dari state dan lewat apa adanya.
      if (event.lifecycle === "dropped" || pos?.onGround !== true) {
        states.delete(id);
        return event;
      }

      const t = now();
      const st = states.get(id) ?? newState(event, t);
      states.set(id, st);
      st.lastAt = t;
      const raw: LatLon = { lat: pos.lat, lon: pos.lon };
      const speed = event.velocity?.groundSpeed ?? 0;

      return (
        whileFrozen(event, st, raw, speed) ??
        rejectJump(event, st, raw, t) ??
        moving(event, st, raw, speed, t)
      );
    },

    forget(trackId: string): void {
      states.delete(trackId);
    },

    sweep(): void {
      const t = now();
      for (const [id, st] of states) {
        if (t - st.lastAt > opts.forgetAfterMs) states.delete(id);
      }
    },

    stats(): StabilizerStats {
      return { ...counters };
    },
  };
}
