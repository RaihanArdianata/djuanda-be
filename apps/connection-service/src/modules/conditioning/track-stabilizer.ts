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
 * dihitung dari posisi itu ikut bergoyang.
 *
 * Penyaringnya KONTINU (bukan "bekukan lalu lompat"), supaya gerak tetap mulus:
 *
 *  - Zona mati dengan tali: posisi yang ditampilkan hanya bergerak bila posisi sensor menjauh lebih dari `radiusM` (saat lambat) atau
 *    `moveRadiusM` (saat bergerak) darinya, dan saat bergerak ia ditarik seperti dengan tali sepanjang radius itu. Derau di dalam radius
 *    tidak menggeser apa-apa, jadi pesawat yang diam jadi satu titik; pesawat yang bergerak diikuti tanpa lompatan.
 *  - Langkah per laporan dibatasi sesuai kecepatan pesawat sendiri, jadi menyusul setelah tertahan berjalan mulus, tidak melompat.
 *  - Lonjakan mustahil ditolak sampai `maxRejects` kali berturut-turut. Batasnya menyesuaikan kecepatan pesawat sendiri (mis. pesawat yang
 *    melaju 120 kt di landasan tidak dianggap melompat).
 *  - Arah dihitung dari gerak yang sebenarnya (minimal `headingMinMoveM`), bukan dari heading sensor yang berderau; selama belum bergerak
 *    jauh, arah terakhir dipertahankan.
 *  - Hanya target di permukaan (`onGround`). Pesawat di udara tidak disentuh.
 */

export interface StabilizerOptions {
  /** Di bawah kecepatan ini (knot) target dianggap diam atau merayap. */
  standKt: number;
  /** Zona mati saat diam atau merayap: derau sampai sejauh ini tidak menggeser posisi, meter. */
  radiusM: number;
  /** Zona mati saat bergerak normal (di atas `standKt`), meter. Sekaligus selisih posisi tampil dan posisi sensor. */
  moveRadiusM: number;
  /** Langkah lebih cepat dari ini (knot), dan lebih dari 3 kali kecepatan pesawat sendiri, dianggap lonjakan palsu. */
  maxJumpKt: number;
  /** Berapa laporan berturut-turut yang boleh ditolak sebagai lonjakan sebelum dianggap kenyataan. */
  maxRejects: number;
  /** Arah baru dihitung dari gerak sejauh ini, meter. */
  headingMinMoveM: number;
  /** State target yang tidak melapor sekian lama dibuang, ms. */
  forgetAfterMs: number;
  now?: () => number;
}

export const DEFAULT_STABILIZER_OPTIONS: StabilizerOptions = {
  standKt: 6,
  radiusM: 15,
  moveRadiusM: 3,
  maxJumpKt: 80,
  maxRejects: 2,
  headingMinMoveM: 10,
  forgetAfterMs: 120_000,
};

export interface StabilizerStats {
  /** Laporan yang tidak menggeser posisi tampil (derau di dalam zona mati). */
  heldReports: number;
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
  /** Posisi yang ditampilkan. */
  out: LatLon;
  /** Laporan sensor terakhir yang diterima (bukan lonjakan), dan kapan. */
  lastRaw: LatLon & { at: number };
  /** Kecepatan dilaporkan yang dihaluskan, knot. */
  speed: number;
  heading?: number;
  /** Titik tampil terakhir yang bergerak cukup jauh, untuk menghitung arah. */
  trail: LatLon[];
  rejects: number;
  lastAt: number;
}

const KT_TO_MPS: number = 0.514444;
const TRAIL_LEN: number = 12;
/** Langkah maksimum per laporan = kecepatan pesawat x selang x faktor ini + tambahan kecil, supaya menyusul tidak melompat. */
const STEP_FACTOR: number = 1.5;
const MIN_STEP_M: number = 2;
const MIN_DT_S: number = 0.2;
const MAX_DT_S: number = 10;

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

/** Titik sejauh `metres` dari `from` ke arah `to` (bidang datar). */
function towards(from: LatLon, to: LatLon, metres: number): LatLon {
  const total = distanceM(from, to);
  if (total === 0) return from;
  const f = Math.min(1, metres / total);
  return {
    lat: from.lat + (to.lat - from.lat) * f,
    lon: from.lon + (to.lon - from.lon) * f,
  };
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

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
  const counters: StabilizerStats = { heldReports: 0, jumpsRejected: 0 };

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

  /** Lonjakan mustahil terhadap laporan sensor sebelumnya; batasnya mengikuti kecepatan pesawat sendiri. */
  function isJump(
    st: State,
    raw: LatLon,
    t: number,
    reportedKt: number,
  ): boolean {
    const dtS = clamp((t - st.lastRaw.at) / 1000, MIN_DT_S, MAX_DT_S);
    const impliedKt = distanceM(raw, st.lastRaw) / dtS / KT_TO_MPS;
    const allowedKt = Math.max(
      opts.maxJumpKt,
      3 * Math.max(reportedKt, st.speed),
    );
    return impliedKt > allowedKt;
  }

  /** Zona mati dengan tali: bergerak hanya sejauh yang diperlukan agar posisi sensor ada di dalam radius, dan tidak lebih cepat dari pesawatnya. */
  function follow(st: State, raw: LatLon, dtS: number, slow: boolean): LatLon {
    const radius = slow ? opts.radiusM : opts.moveRadiusM;
    const gap = distanceM(raw, st.out);
    if (gap <= radius) {
      counters.heldReports++;
      return st.out;
    }
    const maxStep = Math.max(
      Math.max(st.speed, opts.standKt) * KT_TO_MPS * dtS * STEP_FACTOR,
      MIN_STEP_M,
    );
    return towards(st.out, raw, Math.min(gap - radius, maxStep));
  }

  /** Posisi tampil bergeser: catat di jejak pendek dan perbarui arah dari gerak. */
  function moveTo(
    st: State,
    next: LatLon,
    sensorHeading: number | undefined,
  ): void {
    st.out = next;
    st.trail.push(next);
    if (st.trail.length > TRAIL_LEN) st.trail.shift();
    st.heading = headingFrom(st, next, sensorHeading);
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
      const raw: LatLon = { lat: pos.lat, lon: pos.lon };
      const reportedKt = event.velocity?.groundSpeed ?? 0;
      const st = states.get(id);

      // Laporan pertama: tampil apa adanya, arahnya dari sensor sampai target terbukti bergerak.
      if (!st) {
        states.set(id, {
          out: raw,
          lastRaw: { ...raw, at: t },
          speed: reportedKt,
          heading: event.velocity?.heading,
          trail: [raw],
          rejects: 0,
          lastAt: t,
        });
        return event;
      }

      // Lonjakan mustahil: tahan posisi tampil, dan lepas bila terus berlanjut (berarti nyata).
      if (st.rejects < opts.maxRejects && isJump(st, raw, t, reportedKt)) {
        st.rejects++;
        st.lastAt = t;
        counters.jumpsRejected++;
        return withMotion(event, st.out, reportedKt, st.heading);
      }
      const dtS = clamp((t - st.lastRaw.at) / 1000, MIN_DT_S, MAX_DT_S);
      st.rejects = 0;
      st.lastRaw = { ...raw, at: t };
      st.lastAt = t;
      st.speed = st.speed * 0.5 + reportedKt * 0.5;

      const slow = st.speed < opts.standKt;
      const next = follow(st, raw, dtS, slow);
      const moved = distanceM(next, st.out) > 0;
      if (moved) moveTo(st, next, event.velocity?.heading);
      // Tidak bergeser dan pelan: kecepatan dilaporkan 0, bukan derau 0 sampai 5 kt dari sensor.
      const speedOut = !moved && slow ? 0 : event.velocity?.groundSpeed;
      return withMotion(event, next, speedOut, st.heading);
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
