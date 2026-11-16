import { isAirborne } from "../../airborne";
import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";

const DEFAULT_HORIZON_SECONDS = 60;

/** Pemisahan vertikal minimum bawaan (ft) bila aturan tidak mengisinya; `0` atau `null` di konfigurasi mematikan pemeriksaan vertikal. */
const DEFAULT_MIN_VERTICAL_FT = 1000;

function minimumVerticalFt(
  config: Record<string, unknown>,
): number | undefined {
  const value = config.minimumVerticalSeparationFt;
  if (value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value))
    return DEFAULT_MIN_VERTICAL_FT;
  return value > 0 ? value : undefined;
}

/** Ambang STCA di darat bila `includeSurface` menyala: jauh lebih kecil dari di udara (3 NM akan memicu alert untuk dua target diam di apron). */
const DEFAULT_SURFACE_MIN_SEPARATION_M = 50;
const DEFAULT_SURFACE_HORIZON_SECONDS = 10;
const METERS_PER_NM = 1852;

/** STCA punya dua varian: di udara (AIR) dan di darat (SURFACE), masing-masing dengan ambang sendiri. */
type StcaDomain = "AIR" | "SURFACE";

interface PoolParams {
  domain: StcaDomain;
  horizonSeconds: number;
  /** Batas pemisahan horizontal (NM). */
  limitNm: number;
  verticalFt: number | undefined;
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

function buildCandidate(
  ctx: AlertContext,
  a: AlertContext["tracks"][0],
  b: AlertContext["tracks"][0],
  pairKey: string,
  conflict: Conflict,
  p: PoolParams,
): AlertCandidate {
  const distanceNm = conflict.distanceNm;
  const callsignA = a.callsign ?? a.trackId;
  const callsignB = b.callsign ?? b.trackId;
  const surface = p.domain === "SURFACE";
  const separation = surface
    ? `${Math.round(distanceNm * METERS_PER_NM)} m`
    : `${distanceNm.toFixed(2)} NM`;
  return {
    alertId: `STCA|${ctx.airportId}|${pairKey}`,
    airportId: ctx.airportId,
    type: "STCA",
    severity: "CRITICAL",
    status: "ACTIVE",
    trackId: a.trackId,
    relatedTrackId: b.trackId,
    triggeredAt: ctx.timestamp,
    data: {
      // AIR atau SURFACE: klien menampilkan STCA udara dan STCA darat sebagai dua jenis yang berbeda.
      domain: p.domain,
      callsign: callsignA,
      relatedCallsign: callsignB,
      message: `${callsignA} and ${callsignB} predicted below minimum separation (${separation} in ${Math.round(conflict.timeSeconds)}s${surface ? ", surface" : ""})`,
      latitude: (a.latitude + b.latitude) / 2,
      longitude: (a.longitude + b.longitude) / 2,
      track: trackSnapshot(a),
      relatedTrack: trackSnapshot(b),
      predictedTimeSeconds: Math.round(conflict.timeSeconds),
      predictionHorizonSeconds: p.horizonSeconds,
      horizontalSeparationNm: distanceNm,
      minimumHorizontalSeparationNm: p.limitNm,
      ...(surface && {
        horizontalSeparationMeters: distanceNm * METERS_PER_NM,
        minimumSeparationMeters: p.limitNm * METERS_PER_NM,
      }),
      predictedVerticalSeparationFt:
        a.altitude !== undefined && b.altitude !== undefined
          ? Math.abs(a.altitude - b.altitude)
          : null,
      minimumVerticalSeparationFt: p.verticalFt ?? null,
    },
  };
}

interface Conflict {
  /** Jarak horizontal (NM) pada titik terdekat. */
  distanceNm: number;
  /** Detik dari sekarang sampai titik terdekat itu. */
  timeSeconds: number;
}

/**
 * Titik terdekat kedua target dalam `horizonSeconds` ke depan, dengan gerak lurus dan kecepatan tetap. Berbeda dengan memeriksa jarak
 * hanya di ujung waktu prediksi: dua pesawat yang jalurnya berpotongan lalu saling melewati sebelum waktu itu tetap tertangkap.
 */
function closestApproach(
  a: AlertContext["tracks"][0],
  b: AlertContext["tracks"][0],
  horizonSeconds: number,
): Conflict {
  const cosLat = Math.cos((((a.latitude + b.latitude) / 2) * Math.PI) / 180);
  // Posisi b relatif terhadap a (NM): timur dan utara.
  const rx = (b.longitude - a.longitude) * 60 * cosLat;
  const ry = (b.latitude - a.latitude) * 60;
  const vel = (t: AlertContext["tracks"][0]): [number, number] => {
    const rad = ((t.heading ?? 0) * Math.PI) / 180;
    const nmPerS = (t.groundSpeed ?? 0) / 3600;
    return [Math.sin(rad) * nmPerS, Math.cos(rad) * nmPerS];
  };
  const [ax, ay] = vel(a);
  const [bx, by] = vel(b);
  const vx = bx - ax;
  const vy = by - ay;
  const v2 = vx * vx + vy * vy;
  const t =
    v2 === 0
      ? 0
      : Math.max(0, Math.min(horizonSeconds, -(rx * vx + ry * vy) / v2));
  return { distanceNm: Math.hypot(rx + vx * t, ry + vy * t), timeSeconds: t };
}

/** Konflik pasangan ini bila jalurnya mendekat di bawah batas dalam waktu prediksi; `undefined` bila tidak (atau tidak dinilai). */
function findConflict(
  a: AlertContext["tracks"][0],
  b: AlertContext["tracks"][0],
  p: PoolParams,
): Conflict | undefined {
  // Callsign sama = satu pesawat yang terlihat dua kali (dua trackId dari dua jalur feed), bukan dua pesawat yang berdekatan.
  if (a.callsign && a.callsign === b.callsign) return undefined;

  // Selisih tinggi sama dengan atau di bawah batas = masih konflik; lebih dari itu terpisah vertikal.
  if (p.verticalFt !== undefined) {
    if (a.altitude === undefined || b.altitude === undefined) return undefined;
    if (Math.abs(a.altitude - b.altitude) > p.verticalFt) return undefined;
  }

  const conflict = closestApproach(a, b, p.horizonSeconds);
  return conflict.distanceNm < p.limitNm ? conflict : undefined;
}

/** Pasangan di dalam satu kumpulan target (semua di udara, atau semua di darat) yang diperkirakan terlalu dekat. */
function evaluatePool(
  ctx: AlertContext,
  tracks: AlertContext["tracks"],
  p: PoolParams,
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i];
      const b = tracks[j];
      const pairKey = [a.trackId, b.trackId].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      const conflict = findConflict(a, b, p);
      if (conflict) {
        candidates.push(buildCandidate(ctx, a, b, pairKey, conflict, p));
      }
    }
  }
  return candidates;
}

export const stcaRule: DetectionRule = {
  type: "STCA",
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const horizon = numberOr(
      config.predictionTimeSeconds,
      DEFAULT_HORIZON_SECONDS,
    );

    // STCA udara: hanya target di udara. Target yang tidak melaporkan ketinggian (banyak track radar) tidak bisa dinilai
    // pemisahan vertikalnya, dan flag udara/darat mereka tidak bisa dipercaya: tidak ikut. `requireAltitude: false` mengembalikan
    // perilaku lama.
    const air = ctx.tracks
      .filter(isAirborne)
      .filter(
        (t) => config.requireAltitude === false || t.altitude !== undefined,
      );

    const candidates = evaluatePool(ctx, air, {
      domain: "AIR",
      horizonSeconds: horizon,
      limitNm: numberOr(config.minimumHorizontalSeparationNm, 3),
      verticalFt: minimumVerticalFt(config),
    });

    // STCA darat (`includeSurface: true`): dua target di darat (taksi, parkir, kendaraan) dengan ambang sendiri dalam meter.
    // Pasangan campuran (satu di udara, satu di darat) tidak dinilai: itu urusan aturan incursion.
    if (config.includeSurface === true) {
      // Hanya target yang dilaporkan di darat (onGround true); yang tanpa flag atau rendah-lambat tidak ditebak.
      const surface = ctx.tracks.filter((t) => t.onGround === true);
      candidates.push(
        ...evaluatePool(ctx, surface, {
          domain: "SURFACE",
          horizonSeconds: numberOr(
            config.surfacePredictionTimeSeconds,
            DEFAULT_SURFACE_HORIZON_SECONDS,
          ),
          limitNm:
            numberOr(
              config.surfaceMinimumSeparationMeters,
              DEFAULT_SURFACE_MIN_SEPARATION_M,
            ) / METERS_PER_NM,
          verticalFt: undefined,
        }),
      );
    }

    return candidates;
  },
};

function trackSnapshot(track: AlertContext["tracks"][0]): {
  trackId: string;
  callsign: string;
  registration: string | null;
  targetType: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  groundSpeed: number | null;
  heading: number | null;
  onGround: boolean | null;
  timestamp: string;
} {
  return {
    trackId: track.trackId,
    callsign: track.callsign ?? track.trackId,
    registration: track.registration ?? null,
    targetType: track.targetType ?? "AIRCRAFT",
    latitude: track.latitude,
    longitude: track.longitude,
    altitude: track.altitude ?? null,
    groundSpeed: track.groundSpeed ?? null,
    heading: track.heading ?? null,
    onGround: track.onGround ?? null,
    timestamp: track.timestamp.toISOString(),
  };
}
