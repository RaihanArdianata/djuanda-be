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
  distanceNm: number,
  p: PoolParams,
): AlertCandidate {
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
      message: `${callsignA} and ${callsignB} predicted below minimum separation (${separation} in ${p.horizonSeconds}s${surface ? ", surface" : ""})`,
      latitude: (a.latitude + b.latitude) / 2,
      longitude: (a.longitude + b.longitude) / 2,
      track: trackSnapshot(a),
      relatedTrack: trackSnapshot(b),
      predictedTimeSeconds: p.horizonSeconds,
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

/** Jarak (NM) pada waktu prediksi bila pasangan ini terlalu dekat; `undefined` bila tidak (atau tidak dinilai). */
function conflictDistanceNm(
  a: AlertContext["tracks"][0],
  b: AlertContext["tracks"][0],
  p: PoolParams,
): number | undefined {
  // Callsign sama = satu pesawat yang terlihat dua kali (dua trackId dari dua jalur feed), bukan dua pesawat yang berdekatan.
  if (a.callsign && a.callsign === b.callsign) return undefined;

  if (p.verticalFt !== undefined) {
    if (a.altitude === undefined || b.altitude === undefined) return undefined;
    if (Math.abs(a.altitude - b.altitude) >= p.verticalFt) return undefined;
  }

  const distanceNm = haversineNm(
    predict(a, p.horizonSeconds),
    predict(b, p.horizonSeconds),
  );
  return distanceNm < p.limitNm ? distanceNm : undefined;
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

      const distanceNm = conflictDistanceNm(a, b, p);
      if (distanceNm !== undefined) {
        candidates.push(buildCandidate(ctx, a, b, pairKey, distanceNm, p));
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
      const surface = ctx.tracks.filter((t) => !isAirborne(t));
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

function predict(
  track: AlertContext["tracks"][0],
  seconds: number,
): { latitude: number; longitude: number } {
  const speedKnots = track.groundSpeed ?? 0;
  const heading = track.heading ?? 0;
  const distanceNm = (speedKnots * seconds) / 3600;

  const latRad = (track.latitude * Math.PI) / 180;
  const lonRad = (track.longitude * Math.PI) / 180;
  const bearing = (heading * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(latRad) * Math.cos(distanceNm / 3440) +
      Math.cos(latRad) * Math.sin(distanceNm / 3440) * Math.cos(bearing),
  );
  const lon2 =
    lonRad +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distanceNm / 3440) * Math.cos(latRad),
      Math.cos(distanceNm / 3440) - Math.sin(latRad) * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
  };
}

function haversineNm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 3440;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
