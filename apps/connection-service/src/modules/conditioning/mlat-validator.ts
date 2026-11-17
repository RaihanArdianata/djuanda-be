import type { FusedTrackEvent } from "@aeroswarm/core";
import { distanceM, type LatLon } from "./geo";

/**
 * Validasi keandalan data MLAT pesawat.
 *
 * Memeriksa apakah data pesawat yang bersumber dari feed/protokol MLAT (CAT010/CAT011/CAT020/feed mlat)
 * masih layak digunakan dalam pemantauan. Kriteria keandalan:
 *  1. Koordinat valid (bukan NaN/null/0,0).
 *  2. Tidak mengalami lonjakan posisi (teleportasi) yang menghasilkan kecepatan turunan ekstrem.
 *  3. Kualitas/confidence memenuhi ambang batas minimum.
 *  4. Ketinggian dalam batas cakupan MLAT (opsional, default 5000 ft).
 *
 * Catatan: Validasi kecepatan tidak dilakukan karena MLAT terutama untuk surveilans permukaan bandara
 * dan operasi takeoff/landing memerlukan kecepatan tinggi yang wajar.
 *
 * Ladder tindakan:
 *  - pass: data andal, diteruskan ke fusi dan gambaran udara.
 *  - hold: data anomali atau belum andal, ditahan agar tidak masuk ke frontend.
 *  - retract: pesawat sempat tampil di frontend namun keandalannya terdegradasi berturut-turut,
 *             diteruskan dengan lifecycle "dropped" sekali agar dikeluarkan dari pantauan frontend.
 */

export interface MlatValidatorOptions {
  enabled: boolean;
  /** Batas kecepatan lompatan posisi di permukaan, knot (bawaan 150). */
  maxGroundJumpSpeedKt: number;
  /** Batas kecepatan lompatan posisi di udara, knot (bawaan 800). */
  maxAirJumpSpeedKt: number;
  /** Batas minimum confidence overall (0..1, bawaan 0.4). */
  minConfidence: number;
  /** Laporan anomali berturut-turut sebelum pesawat yang tampil ditarik dari frontend (bawaan 3). */
  unreliableThreshold: number;
  /** Laporan valid berturut-turut sebelum status keandalan dipulihkan (bawaan 3). */
  recoveryThreshold: number;
  /** Waktu tanpa laporan valid sebelum track dianggap basi, ms (bawaan 10.000). */
  maxStaleMs: number;
  /** Waktu tanpa pembaruan sebelum state dibersihkan, ms (bawaan 120.000). */
  forgetAfterMs: number;
  /**
   * Batas ketinggian maksimum pesawat yang masih ditampilkan, ft (bawaan 5000).
   * Area cakupan MLAT terbatas di sekitar bandara; pesawat di atas batas ini
   * dianggap di luar cakupan sensor dan tidak andal. 0 = tanpa batas.
   */
  maxAltitudeFt: number;
  now?: () => number;
}

export const DEFAULT_MLAT_VALIDATOR_OPTIONS: MlatValidatorOptions = {
  enabled: true,
  maxGroundJumpSpeedKt: 150,
  maxAirJumpSpeedKt: 800,
  minConfidence: 0.4,
  unreliableThreshold: 3,
  recoveryThreshold: 3,
  maxStaleMs: 10_000,
  forgetAfterMs: 120_000,
  maxAltitudeFt: 5000,
};

export type MlatVerdict =
  | { action: "pass" }
  | { action: "hold"; reason: string }
  | { action: "retract"; reason: string };

export interface MlatValidatorStats {
  inspected: number;
  unreliableReports: number;
  retractedTracks: number;
  recoveredTracks: number;
}

export interface MlatValidator {
  check(event: FusedTrackEvent): MlatVerdict;
  forget(trackId: string): void;
  sweep(): void;
  stats(): MlatValidatorStats;
}

/** Mengecek apakah event bersumber dari feed/protokol MLAT. */
export function isMlatTrack(event: FusedTrackEvent): boolean {
  if (
    event.protocol === "asterix-cat010" ||
    event.protocol === "asterix-cat011" ||
    event.protocol === "asterix-cat020"
  ) {
    return true;
  }
  if (event.position?.altSource === "mlat") {
    return true;
  }
  if (event.sources?.some((s) => s.toLowerCase().includes("mlat"))) {
    return true;
  }
  return false;
}

/** Mengecek apakah target adalah pesawat (bukan kendaraan darat/service vehicle). */
export function isAircraft(event: FusedTrackEvent): boolean {
  if (event.identity?.targetType === "vehicle") return false;
  if (event.identity?.vehicleFleet !== undefined) return false;
  const icao = event.identity?.icao24;
  if (icao?.startsWith("v")) return false;
  return true;
}

interface TrackState {
  shown: boolean;
  unreliable: boolean;
  streakBad: number;
  streakGood: number;
  lastPos?: LatLon & { at: number; onGround?: boolean };
  lastAt: number;
}

const MPS_TO_KT = 1.94384;

function validateCoordinates(pos: FusedTrackEvent["position"]): string | null {
  if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) {
    return "koordinat posisi tidak valid";
  }
  if (
    pos.lat < -90 ||
    pos.lat > 90 ||
    pos.lon < -180 ||
    pos.lon > 180 ||
    (pos.lat === 0 && pos.lon === 0)
  ) {
    return "koordinat di luar batas valid";
  }
  return null;
}

function validateJump(
  pos: LatLon & { onGround?: boolean },
  lastPos: TrackState["lastPos"],
  at: number,
  maxGroundJumpKt: number,
  maxAirJumpKt: number,
): string | null {
  if (!lastPos) return null;
  const dtS = (at - lastPos.at) / 1000;
  if (dtS < 0.2) return null;
  const distM = distanceM(lastPos, pos);
  const derivedKt = (distM / dtS) * MPS_TO_KT;
  const maxJump = pos.onGround ? maxGroundJumpKt : maxAirJumpKt;
  if (derivedKt > maxJump) {
    return `lonjakan posisi teleportasi (${Math.round(derivedKt)} kt) melebihi batas (${maxJump} kt)`;
  }
  return null;
}

function validateConfidence(
  conf: FusedTrackEvent["confidence"],
  minConfidence: number,
): string | null {
  if (!conf) return null;
  if (conf.overall !== undefined && conf.overall < minConfidence) {
    return `confidence overall (${conf.overall.toFixed(2)}) di bawah batas (${minConfidence})`;
  }
  if (conf.position !== undefined && conf.position < minConfidence) {
    return `confidence posisi (${conf.position.toFixed(2)}) di bawah batas (${minConfidence})`;
  }
  return null;
}

function validateAltitude(
  pos: FusedTrackEvent["position"],
  maxAltitudeFt: number,
): string | null {
  if (maxAltitudeFt <= 0) return null;
  const alt = pos?.alt;
  if (alt === undefined || !Number.isFinite(alt)) return null;
  if (alt > maxAltitudeFt) {
    return `ketinggian (${Math.round(alt)} ft) melebihi batas cakupan MLAT (${maxAltitudeFt} ft)`;
  }
  return null;
}

function handleValidReport(
  st: TrackState,
  pos: NonNullable<FusedTrackEvent["position"]>,
  at: number,
  opts: MlatValidatorOptions,
  counters: MlatValidatorStats,
): MlatVerdict {
  st.streakGood++;
  st.streakBad = 0;
  st.lastPos = {
    lat: pos.lat,
    lon: pos.lon,
    at,
    onGround: pos.onGround,
  };

  if (!st.unreliable) {
    st.shown = true;
    return { action: "pass" };
  }

  if (st.streakGood < opts.recoveryThreshold) {
    return {
      action: "hold",
      reason: "pemulihan keandalan MLAT belum mencukupi laporan konsisten",
    };
  }

  st.unreliable = false;
  st.shown = true;
  counters.recoveredTracks++;
  return { action: "pass" };
}

function handleInvalidReport(
  st: TrackState,
  reason: string,
  opts: MlatValidatorOptions,
  counters: MlatValidatorStats,
): MlatVerdict {
  counters.unreliableReports++;
  st.streakBad++;
  st.streakGood = 0;

  const shouldRetractOrHold =
    st.streakBad >= opts.unreliableThreshold || st.unreliable;
  if (!shouldRetractOrHold) {
    return { action: "hold", reason };
  }

  if (st.shown) {
    st.shown = false;
    st.unreliable = true;
    counters.retractedTracks++;
    return { action: "retract", reason };
  }

  st.unreliable = true;
  return { action: "hold", reason };
}

export function createMlatValidator(
  options: Partial<MlatValidatorOptions> = {},
): MlatValidator {
  const opts: MlatValidatorOptions = {
    ...DEFAULT_MLAT_VALIDATOR_OPTIONS,
    ...Object.fromEntries(
      Object.entries(options).filter(([, v]) => v !== undefined),
    ),
  };
  const now = options.now ?? ((): number => Date.now());
  const tracks = new Map<string, TrackState>();
  const counters: MlatValidatorStats = {
    inspected: 0,
    unreliableReports: 0,
    retractedTracks: 0,
    recoveredTracks: 0,
  };

  function validateReport(
    event: FusedTrackEvent,
    st: TrackState,
    at: number,
  ): string | null {
    const pos = event.position;
    const coordErr = validateCoordinates(pos);
    if (coordErr) return coordErr;

    const jumpErr = pos
      ? validateJump(
          pos,
          st.lastPos,
          at,
          opts.maxGroundJumpSpeedKt,
          opts.maxAirJumpSpeedKt,
        )
      : null;
    if (jumpErr) return jumpErr;

    const altErr = validateAltitude(pos, opts.maxAltitudeFt);
    if (altErr) return altErr;

    return validateConfidence(event.confidence, opts.minConfidence);
  }

  return {
    check(event: FusedTrackEvent): MlatVerdict {
      if (!opts.enabled) return { action: "pass" };
      if (event.lifecycle === "dropped") return { action: "pass" };
      if (!isMlatTrack(event) || !isAircraft(event)) {
        return { action: "pass" };
      }

      counters.inspected++;
      const at = now();
      const key = event.identity?.icao24 || event.trackId;
      let st = tracks.get(key);
      if (!st) {
        st = {
          shown: false,
          unreliable: false,
          streakBad: 0,
          streakGood: 0,
          lastAt: at,
        };
        tracks.set(key, st);
      }
      st.lastAt = at;

      const reason = validateReport(event, st, at);
      if (reason !== null) {
        return handleInvalidReport(st, reason, opts, counters);
      }

      const pos = event.position;
      if (!pos) return { action: "pass" };
      return handleValidReport(st, pos, at, opts, counters);
    },

    forget(trackId: string): void {
      tracks.delete(trackId);
    },

    sweep(): void {
      const at = now();
      for (const [k, st] of tracks) {
        if (at - st.lastAt > opts.forgetAfterMs) {
          tracks.delete(k);
          continue;
        }
        if (st.shown && at - st.lastAt > opts.maxStaleMs) {
          st.shown = false;
          st.unreliable = true;
          counters.retractedTracks++;
        }
      }
    },

    stats(): MlatValidatorStats {
      return { ...counters };
    },
  };
}
