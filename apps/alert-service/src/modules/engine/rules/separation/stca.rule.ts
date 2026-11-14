import { isAirborne } from "../../airborne";
import { type AlertArea, distanceFromCenterM } from "../../alert-area";
import type {
  AlertCandidate,
  AlertContext,
  DetectionRule,
  MovementTrack,
} from "../../types";
import { haversineMeters } from "../geometry/geometry";

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
const METERS_PER_FT = 0.3048;

const DEFAULT_HIGH_SEPARATION_M = 5000;
const DEFAULT_MIN_ALTITUDE_FT = 1500;
const DEFAULT_MID_SEPARATION_M = 3000;
const DEFAULT_MID_ALTITUDE_FT = 1000;
const DEFAULT_CLOSE_SEPARATION_M = 50;

export type StcaCategory = "AIR_HIGH" | "AIR_MID" | "AIR_CLOSE" | "SURFACE";

type StcaDomain = "AIR" | "SURFACE";

interface PoolParams {
  domain: StcaDomain;
  category: StcaCategory;
  horizonSeconds: number;
  /** Batas pemisahan horizontal (NM). */
  limitNm: number;
  verticalFt: number | undefined;
  useMeters: boolean;
  minimumSeparationMeters?: number;
}

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

function trackAltitudeFt(track: MovementTrack): number | null {
  return track.altitude !== undefined ? track.altitude : null;
}

/**
 * Bukti pemilihan kategori — bukan batas geometri yang dipakai rule.
 * `distanceFromCenterM` = jarak **terjauh** anggota pasangan ke ARP.
 * `altitudeFt` = ketinggian **minimum** pasangan.
 * `radiusM` = radius zona kategori (alas kubah udara / radius darat / 50% darat),
 * bukan tinggi efektif kubah elipsoid dan bukan ambang pemisahan.
 */
function zonePayload(
  a: MovementTrack,
  b: MovementTrack,
  area: AlertArea | null | undefined,
  radiusM: number | null,
): {
  distanceFromCenterM: number | null;
  radiusM: number | null;
  altitudeFt: number | null;
} {
  const altA = trackAltitudeFt(a);
  const altB = trackAltitudeFt(b);
  const altitudeFt =
    altA !== null && altB !== null ? Math.min(altA, altB) : (altA ?? altB);
  if (!area) {
    return { distanceFromCenterM: null, radiusM, altitudeFt };
  }
  return {
    distanceFromCenterM: Math.max(
      distanceFromCenterM(a, area),
      distanceFromCenterM(b, area),
    ),
    radiusM,
    altitudeFt,
  };
}

function categoryRadiusM(
  ctx: AlertContext,
  category: StcaCategory,
): number | null {
  if (!ctx.alertArea) return null;
  if (category === "AIR_CLOSE" || category === "SURFACE") {
    return ctx.alertArea.groundRadiusM;
  }
  return ctx.alertArea.airRadiusM;
}

function candidateMessage(
  callsignA: string,
  callsignB: string,
  distance: string,
  p: PoolParams,
): string {
  const current = p.category === "AIR_CLOSE";
  const time =
    current || p.horizonSeconds <= 0 ? "" : ` in ${p.horizonSeconds}s`;
  const surface = p.domain === "SURFACE" ? ", surface" : "";
  const verb = current ? "below" : "predicted below";
  return `${callsignA} and ${callsignB} ${verb} minimum separation (${distance}${time}${surface})`;
}

function separationData(
  distanceNm: number,
  p: PoolParams,
): Record<string, unknown> {
  if (!p.useMeters) return {};
  return {
    horizontalSeparationMeters: distanceNm * METERS_PER_NM,
    minimumSeparationMeters:
      p.minimumSeparationMeters ?? p.limitNm * METERS_PER_NM,
  };
}

function buildCandidate(
  ctx: AlertContext,
  a: MovementTrack,
  b: MovementTrack,
  pairKey: string,
  distanceNm: number,
  p: PoolParams,
): AlertCandidate {
  const callsignA = a.callsign ?? a.trackId;
  const callsignB = b.callsign ?? b.trackId;
  const separation = p.useMeters
    ? `${Math.round(distanceNm * METERS_PER_NM)} m`
    : `${distanceNm.toFixed(2)} NM`;
  const current = p.category === "AIR_CLOSE";
  const pa =
    current || p.horizonSeconds <= 0 ? null : predict(a, p.horizonSeconds);
  const pb =
    current || p.horizonSeconds <= 0 ? null : predict(b, p.horizonSeconds);
  const predictedVertical =
    pa?.altitude != null && pb?.altitude != null
      ? Math.abs(pa.altitude - pb.altitude)
      : a.altitude !== undefined && b.altitude !== undefined
        ? Math.abs(a.altitude - b.altitude)
        : null;

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
      category: p.category,
      zone: zonePayload(a, b, ctx.alertArea, categoryRadiusM(ctx, p.category)),
      callsign: callsignA,
      relatedCallsign: callsignB,
      message: candidateMessage(callsignA, callsignB, separation, p),
      latitude: (a.latitude + b.latitude) / 2,
      longitude: (a.longitude + b.longitude) / 2,
      track: trackSnapshot(a),
      relatedTrack: trackSnapshot(b),
      predictedTimeSeconds: current ? null : p.horizonSeconds,
      horizontalSeparationNm: distanceNm,
      minimumHorizontalSeparationNm: p.limitNm,
      ...separationData(distanceNm, p),
      predictedVerticalSeparationFt: predictedVertical,
      minimumVerticalSeparationFt: p.verticalFt ?? null,
    },
  };
}

export interface CpaResult {
  timeToCpaSeconds: number;
  minSeparationMeters: number;
  converging: boolean;
}

export function calculateCpa(
  a: MovementTrack,
  b: MovementTrack,
  horizonSeconds: number,
): CpaResult {
  const speedA = ((a.groundSpeed ?? 0) * METERS_PER_NM) / 3600;
  const speedB = ((b.groundSpeed ?? 0) * METERS_PER_NM) / 3600;
  const hdgA = ((a.heading ?? 0) * Math.PI) / 180;
  const hdgB = ((b.heading ?? 0) * Math.PI) / 180;

  const vxA = speedA * Math.sin(hdgA);
  const vyA = speedA * Math.cos(hdgA);
  const vxB = speedB * Math.sin(hdgB);
  const vyB = speedB * Math.cos(hdgB);

  const dvx = vxA - vxB;
  const dvy = vyA - vyB;

  const midLat = (((a.latitude + b.latitude) / 2) * Math.PI) / 180;
  const dx =
    (((b.longitude - a.longitude) * Math.PI) / 180) *
    6371008.8 *
    Math.cos(midLat);
  const dy = (((b.latitude - a.latitude) * Math.PI) / 180) * 6371008.8;

  const currentDistM = Math.sqrt(dx * dx + dy * dy);
  const vRelSq = dvx * dvx + dvy * dvy;

  if (vRelSq < 1e-4) {
    return {
      timeToCpaSeconds: horizonSeconds,
      minSeparationMeters: currentDistM,
      converging: false,
    };
  }

  const dot = dx * dvx + dy * dvy;
  const tCpa = dot / vRelSq;

  if (tCpa <= 0) {
    return {
      timeToCpaSeconds: 0,
      minSeparationMeters: currentDistM,
      converging: false,
    };
  }

  if (tCpa > horizonSeconds) {
    const px = dx - dvx * horizonSeconds;
    const py = dy - dvy * horizonSeconds;
    return {
      timeToCpaSeconds: horizonSeconds,
      minSeparationMeters: Math.sqrt(px * px + py * py),
      converging: true,
    };
  }

  const minPx = dx - dvx * tCpa;
  const minPy = dy - dvy * tCpa;
  return {
    timeToCpaSeconds: Math.round(tCpa),
    minSeparationMeters: Math.sqrt(minPx * minPx + minPy * minPy),
    converging: true,
  };
}

interface ConflictResult {
  distanceNm: number;
  conflictSeconds: number;
}

/** Jarak (NM) pada waktu prediksi bila pasangan ini terlalu dekat; `undefined` bila tidak (atau tidak dinilai). */
function conflictDistanceNm(
  a: MovementTrack,
  b: MovementTrack,
  p: Pick<PoolParams, "horizonSeconds" | "limitNm" | "verticalFt">,
): ConflictResult | undefined {
  // Callsign sama = satu pesawat yang terlihat dua kali (dua trackId dari dua jalur feed), bukan dua pesawat yang berdekatan.
  if (a.callsign && a.callsign === b.callsign) return undefined;

  const cpa = calculateCpa(a, b, p.horizonSeconds);
  const conflictSeconds =
    cpa.timeToCpaSeconds > 0 ? cpa.timeToCpaSeconds : p.horizonSeconds;

  const pa = predict(a, conflictSeconds);
  const pb = predict(b, conflictSeconds);

  if (p.verticalFt !== undefined) {
    const vert =
      pa.altitude != null && pb.altitude != null
        ? Math.abs(pa.altitude - pb.altitude)
        : a.altitude !== undefined && b.altitude !== undefined
          ? Math.abs(a.altitude - b.altitude)
          : undefined;
    if (vert === undefined || vert >= p.verticalFt) return undefined;
  }

  const endPa = predict(a, p.horizonSeconds);
  const endPb = predict(b, p.horizonSeconds);
  const endDistNm = haversineNm(endPa, endPb);
  const cpaDistNm = cpa.minSeparationMeters / METERS_PER_NM;
  const distanceNm = Math.min(cpaDistNm, endDistNm);

  if (distanceNm >= p.limitNm) return undefined;

  return {
    distanceNm,
    conflictSeconds,
  };
}

function sameCallsign(a: MovementTrack, b: MovementTrack): boolean {
  return Boolean(a.callsign && a.callsign === b.callsign);
}

function isAircraft(track: MovementTrack): boolean {
  return (track.targetType ?? "AIRCRAFT") === "AIRCRAFT";
}

function currentSeparationM(a: MovementTrack, b: MovementTrack): number {
  return haversineMeters([a.latitude, a.longitude], [b.latitude, b.longitude]);
}

interface AirThresholds {
  closeSeparationM: number;
  midSeparationM: number;
  midAltitudeFt: number;
  highSeparationM: number;
  minAltitudeFt: number;
  horizonSeconds: number;
  highLimitNm: number;
  highVerticalFt: number | undefined;
}

function airThresholds(config: Record<string, unknown>): AirThresholds {
  const highLimitNm = numberOr(config.minimumHorizontalSeparationNm, 3);
  const highSeparationM =
    typeof config.highSeparationMeters === "number" &&
    config.highSeparationMeters > 0
      ? config.highSeparationMeters
      : typeof config.minimumHorizontalSeparationNm === "number" &&
          config.minimumHorizontalSeparationNm > 0
        ? config.minimumHorizontalSeparationNm * METERS_PER_NM
        : DEFAULT_HIGH_SEPARATION_M;

  return {
    closeSeparationM: numberOr(
      config.closeSeparationMeters,
      DEFAULT_CLOSE_SEPARATION_M,
    ),
    midSeparationM: numberOr(
      config.midSeparationMeters,
      DEFAULT_MID_SEPARATION_M,
    ),
    midAltitudeFt: numberOr(config.midAltitudeFt, DEFAULT_MID_ALTITUDE_FT),
    highSeparationM,
    minAltitudeFt: numberOr(config.minAltitudeFt, DEFAULT_MIN_ALTITUDE_FT),
    horizonSeconds: numberOr(
      config.predictionTimeSeconds,
      DEFAULT_HORIZON_SECONDS,
    ),
    highLimitNm,
    highVerticalFt: minimumVerticalFt(config),
  };
}

function tryCloseCandidate(
  ctx: AlertContext,
  a: MovementTrack,
  b: MovementTrack,
  pairKey: string,
  t: AirThresholds,
  ceilingFt: number | null,
  verticalOk: boolean,
): AlertCandidate | undefined {
  if (!isAircraft(a) || !isAircraft(b)) return undefined;
  const underCeiling =
    ceilingFt === null ||
    ((a.altitude === undefined || a.altitude < ceilingFt) &&
      (b.altitude === undefined || b.altitude < ceilingFt));
  if (!underCeiling || !verticalOk) return undefined;

  const nowM = currentSeparationM(a, b);
  if (nowM >= t.closeSeparationM) return undefined;

  return buildCandidate(ctx, a, b, pairKey, nowM / METERS_PER_NM, {
    domain: "AIR",
    category: "AIR_CLOSE",
    horizonSeconds: 0,
    limitNm: t.closeSeparationM / METERS_PER_NM,
    verticalFt: t.highVerticalFt,
    useMeters: true,
    minimumSeparationMeters: t.closeSeparationM,
  });
}

function tryMidCandidate(
  ctx: AlertContext,
  a: MovementTrack,
  b: MovementTrack,
  pairKey: string,
  t: AirThresholds,
  minAlt: number,
): AlertCandidate | undefined {
  if (minAlt <= t.midAltitudeFt || minAlt >= t.minAltitudeFt) return undefined;

  const cpa = calculateCpa(a, b, t.horizonSeconds);
  const conflictSeconds =
    cpa.timeToCpaSeconds > 0 ? cpa.timeToCpaSeconds : t.horizonSeconds;

  const pa = predict(a, conflictSeconds);
  const pb = predict(b, conflictSeconds);
  if (
    t.highVerticalFt !== undefined &&
    pa.altitude != null &&
    pb.altitude != null
  ) {
    if (Math.abs(pa.altitude - pb.altitude) >= t.highVerticalFt)
      return undefined;
  }

  const endPa = predict(a, t.horizonSeconds);
  const endPb = predict(b, t.horizonSeconds);
  const endDistM = haversineMeters(
    [endPa.latitude, endPa.longitude],
    [endPb.latitude, endPb.longitude],
  );
  const minDistanceM = Math.min(cpa.minSeparationMeters, endDistM);

  if (minDistanceM > t.midSeparationM) return undefined;

  return buildCandidate(ctx, a, b, pairKey, minDistanceM / METERS_PER_NM, {
    domain: "AIR",
    category: "AIR_MID",
    horizonSeconds: conflictSeconds,
    limitNm: t.midSeparationM / METERS_PER_NM,
    verticalFt: t.highVerticalFt,
    useMeters: true,
    minimumSeparationMeters: t.midSeparationM,
  });
}

function tryHighCandidate(
  ctx: AlertContext,
  a: MovementTrack,
  b: MovementTrack,
  pairKey: string,
  t: AirThresholds,
  minAlt: number | undefined,
  config: Record<string, unknown>,
): AlertCandidate | undefined {
  const isHighBand = minAlt !== undefined && minAlt >= t.minAltitudeFt;
  const isFallback =
    config.requireAltitude === false &&
    (a.altitude === undefined || b.altitude === undefined);

  if (!isHighBand && !isFallback) return undefined;

  const hit = conflictDistanceNm(a, b, {
    horizonSeconds: t.horizonSeconds,
    limitNm: t.highSeparationM / METERS_PER_NM,
    verticalFt: t.highVerticalFt,
  });
  if (hit === undefined) return undefined;

  return buildCandidate(ctx, a, b, pairKey, hit.distanceNm, {
    domain: "AIR",
    category: "AIR_HIGH",
    horizonSeconds: hit.conflictSeconds,
    limitNm: t.highSeparationM / METERS_PER_NM,
    verticalFt: t.highVerticalFt,
    useMeters: false,
  });
}

function isAboveCeiling(
  ceilingFt: number | null,
  altA?: number,
  altB?: number,
): boolean {
  if (ceilingFt === null) return false;
  return (
    (altA !== undefined && altA >= ceilingFt) ||
    (altB !== undefined && altB >= ceilingFt)
  );
}

function isVerticalSeparated(
  limitFt?: number,
  altA?: number,
  altB?: number,
): boolean {
  if (limitFt === undefined || altA === undefined || altB === undefined) {
    return false;
  }
  return Math.abs(altA - altB) >= limitFt;
}

function evaluateAirPair(
  ctx: AlertContext,
  a: MovementTrack,
  b: MovementTrack,
  pairKey: string,
  config: Record<string, unknown>,
): AlertCandidate | undefined {
  if (sameCallsign(a, b)) return undefined;
  const t = airThresholds(config);

  const altA = a.altitude;
  const altB = b.altitude;
  if (
    config.requireAltitude !== false &&
    (altA === undefined || altB === undefined)
  ) {
    return undefined;
  }

  const ceilingFt =
    ctx.alertArea?.airCeilingM != null
      ? ctx.alertArea.airCeilingM / METERS_PER_FT
      : null;

  const currentVerticalOk = !isVerticalSeparated(t.highVerticalFt, altA, altB);

  // 1. Ladder Priority 1: AIR_CLOSE
  const close = tryCloseCandidate(
    ctx,
    a,
    b,
    pairKey,
    t,
    ceilingFt,
    currentVerticalOk,
  );
  if (close) return close;

  if (isAboveCeiling(ceilingFt, altA, altB)) return undefined;

  const minAlt =
    altA !== undefined && altB !== undefined
      ? Math.min(altA, altB)
      : (altA ?? altB);

  // 2. Ladder Priority 2: AIR_MID
  if (minAlt !== undefined) {
    const mid = tryMidCandidate(ctx, a, b, pairKey, t, minAlt);
    if (mid) return mid;
  }

  // 3. Ladder Priority 3: AIR_HIGH
  return tryHighCandidate(ctx, a, b, pairKey, t, minAlt, config);
}

/** Pasangan di dalam satu kumpulan target (semua di udara, atau semua di darat) yang diperkirakan terlalu dekat. */
function evaluateSurfacePool(
  ctx: AlertContext,
  tracks: MovementTrack[],
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

      const hit = conflictDistanceNm(a, b, p);
      if (hit !== undefined) {
        candidates.push(
          buildCandidate(ctx, a, b, pairKey, hit.distanceNm, {
            ...p,
            horizonSeconds: hit.conflictSeconds,
          }),
        );
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
    // STCA udara: hanya target di udara. Target yang tidak melaporkan ketinggian (banyak track radar) tidak bisa dinilai
    // pemisahan vertikalnya, dan flag udara/darat mereka tidak bisa dipercaya: tidak ikut. `requireAltitude: false` mengembalikan
    // perilaku lama.
    const air = ctx.tracks
      .filter(isAirborne)
      .filter(
        (t) => config.requireAltitude === false || t.altitude !== undefined,
      );

    const candidates: AlertCandidate[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < air.length; i++) {
      for (let j = i + 1; j < air.length; j++) {
        const a = air[i];
        const b = air[j];
        const pairKey = [a.trackId, b.trackId].sort().join("|");
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const hit = evaluateAirPair(ctx, a, b, pairKey, config);
        if (hit) candidates.push(hit);
      }
    }

    // STCA darat (`includeSurface: true`): dua target di darat (taksi, parkir, kendaraan) dengan ambang sendiri dalam meter.
    // Pasangan campuran (satu di udara, satu di darat) tidak dinilai: itu urusan aturan incursion.
    if (config.includeSurface === true) {
      const surface = ctx.tracks.filter((t) => !isAirborne(t));
      const minM = numberOr(
        config.surfaceMinimumSeparationMeters,
        DEFAULT_SURFACE_MIN_SEPARATION_M,
      );
      candidates.push(
        ...evaluateSurfacePool(ctx, surface, {
          domain: "SURFACE",
          category: "SURFACE",
          horizonSeconds: numberOr(
            config.surfacePredictionTimeSeconds,
            DEFAULT_SURFACE_HORIZON_SECONDS,
          ),
          limitNm: minM / METERS_PER_NM,
          verticalFt: undefined,
          useMeters: true,
          minimumSeparationMeters: minM,
        }),
      );
    }

    return candidates;
  },
};

function trackSnapshot(track: MovementTrack): {
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

export interface PredictedPosition3D {
  latitude: number;
  longitude: number;
  altitude: number | null;
}

export function predict(
  track: MovementTrack,
  seconds: number,
): PredictedPosition3D {
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

  let predictedAlt: number | null = null;
  if (track.altitude !== undefined) {
    let alt = track.altitude;
    if (
      track.verticalRate !== undefined &&
      Number.isFinite(track.verticalRate)
    ) {
      alt += (track.verticalRate / 60) * seconds;
    }
    predictedAlt = Math.max(0, Math.round(alt));
  }

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
    altitude: predictedAlt,
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
