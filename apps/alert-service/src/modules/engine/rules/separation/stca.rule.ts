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

const DEFAULT_HIGH_ALTITUDE_FT = 1500;
const DEFAULT_LOW_CROSSING_SEPARATION_M = 500;
const DEFAULT_LOW_CROSSING_VERTICAL_M = 100;
const DEFAULT_LOW_DOME_ALTITUDE_FT = 1000;
const DEFAULT_LOW_DOME_SEPARATION_M = 140;
const DEFAULT_LOW_DOME_RADIUS_FRACTION = 0.5;

export type StcaCategory =
  | "AIR_HIGH"
  | "AIR_LOW_CROSSING"
  | "AIR_LOW_DOME"
  | "SURFACE";

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
  if (category === "AIR_LOW_DOME") {
    return ctx.alertArea.groundRadiusM * DEFAULT_LOW_DOME_RADIUS_FRACTION;
  }
  if (category === "AIR_LOW_CROSSING" || category === "SURFACE") {
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
  const current = p.category === "AIR_LOW_DOME";
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
  const current = p.category === "AIR_LOW_DOME";
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
  a: MovementTrack,
  b: MovementTrack,
  p: Pick<PoolParams, "horizonSeconds" | "limitNm" | "verticalFt">,
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

function sameCallsign(a: MovementTrack, b: MovementTrack): boolean {
  return Boolean(a.callsign && a.callsign === b.callsign);
}

function isAircraft(track: MovementTrack): boolean {
  return (track.targetType ?? "AIRCRAFT") === "AIRCRAFT";
}

function currentSeparationM(a: MovementTrack, b: MovementTrack): number {
  return haversineMeters([a.latitude, a.longitude], [b.latitude, b.longitude]);
}

function predictedSeparationM(
  a: MovementTrack,
  b: MovementTrack,
  seconds: number,
): number {
  const pa = predict(a, seconds);
  const pb = predict(b, seconds);
  return haversineMeters(
    [pa.latitude, pa.longitude],
    [pb.latitude, pb.longitude],
  );
}

function verticalSeparationM(
  a: MovementTrack,
  b: MovementTrack,
): number | undefined {
  if (a.altitude === undefined || b.altitude === undefined) return undefined;
  return Math.abs(a.altitude - b.altitude) * METERS_PER_FT;
}

interface AirThresholds {
  highAltitudeFt: number;
  lowCrossingSeparationM: number;
  lowCrossingVerticalM: number;
  lowDomeAltitudeFt: number;
  lowDomeSeparationM: number;
  lowDomeRadiusFraction: number;
  horizonSeconds: number;
  highLimitNm: number;
  highVerticalFt: number | undefined;
}

function airThresholds(config: Record<string, unknown>): AirThresholds {
  return {
    highAltitudeFt: numberOr(config.highAltitudeFt, DEFAULT_HIGH_ALTITUDE_FT),
    lowCrossingSeparationM: numberOr(
      config.lowCrossingSeparationMeters,
      DEFAULT_LOW_CROSSING_SEPARATION_M,
    ),
    lowCrossingVerticalM: numberOr(
      config.lowCrossingVerticalMeters,
      DEFAULT_LOW_CROSSING_VERTICAL_M,
    ),
    lowDomeAltitudeFt: numberOr(
      config.lowDomeAltitudeFt,
      DEFAULT_LOW_DOME_ALTITUDE_FT,
    ),
    lowDomeSeparationM: numberOr(
      config.lowDomeSeparationMeters,
      DEFAULT_LOW_DOME_SEPARATION_M,
    ),
    lowDomeRadiusFraction: numberOr(
      config.lowDomeRadiusFraction,
      DEFAULT_LOW_DOME_RADIUS_FRACTION,
    ),
    horizonSeconds: numberOr(
      config.predictionTimeSeconds,
      DEFAULT_HORIZON_SECONDS,
    ),
    highLimitNm: numberOr(config.minimumHorizontalSeparationNm, 3),
    highVerticalFt: minimumVerticalFt(config),
  };
}

function inRadius(
  track: MovementTrack,
  area: AlertArea,
  radiusM: number,
): boolean {
  return distanceFromCenterM(track, area) <= radiusM;
}

function bothInLowBand(
  a: MovementTrack,
  b: MovementTrack,
  area: AlertArea,
  highAltitudeFt: number,
): boolean {
  const low = (t: MovementTrack): boolean =>
    t.altitude !== undefined &&
    t.altitude < highAltitudeFt &&
    inRadius(t, area, area.groundRadiusM);
  return low(a) && low(b);
}

function bothInDomeBand(
  a: MovementTrack,
  b: MovementTrack,
  area: AlertArea,
  t: AirThresholds,
): boolean {
  const radiusM = area.groundRadiusM * t.lowDomeRadiusFraction;
  const dome = (track: MovementTrack): boolean =>
    track.altitude !== undefined &&
    track.altitude < t.lowDomeAltitudeFt &&
    inRadius(track, area, radiusM);
  return dome(a) && dome(b);
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
  const area = ctx.alertArea ?? null;

  // Tanpa area: hanya kategori 1 (tanpa batas atas). Kategori 2/3 butuh jarak ke ARP.
  if (area && bothInLowBand(a, b, area, t.highAltitudeFt)) {
    if (isAircraft(a) && isAircraft(b) && bothInDomeBand(a, b, area, t)) {
      const nowM = currentSeparationM(a, b);
      if (nowM <= t.lowDomeSeparationM) {
        return buildCandidate(ctx, a, b, pairKey, nowM / METERS_PER_NM, {
          domain: "AIR",
          category: "AIR_LOW_DOME",
          horizonSeconds: 0,
          limitNm: t.lowDomeSeparationM / METERS_PER_NM,
          verticalFt: undefined,
          useMeters: true,
          minimumSeparationMeters: t.lowDomeSeparationM,
        });
      }
    }

    const predictedM = predictedSeparationM(a, b, t.horizonSeconds);
    const verticalM = verticalSeparationM(a, b);
    if (
      predictedM < t.lowCrossingSeparationM &&
      verticalM !== undefined &&
      verticalM <= t.lowCrossingVerticalM
    ) {
      return buildCandidate(ctx, a, b, pairKey, predictedM / METERS_PER_NM, {
        domain: "AIR",
        category: "AIR_LOW_CROSSING",
        horizonSeconds: t.horizonSeconds,
        limitNm: t.lowCrossingSeparationM / METERS_PER_NM,
        verticalFt: t.lowCrossingVerticalM / METERS_PER_FT,
        useMeters: true,
        minimumSeparationMeters: t.lowCrossingSeparationM,
      });
    }
    return undefined;
  }

  const distanceNm = conflictDistanceNm(a, b, {
    horizonSeconds: t.horizonSeconds,
    limitNm: t.highLimitNm,
    verticalFt: t.highVerticalFt,
  });
  if (distanceNm === undefined) return undefined;
  return buildCandidate(ctx, a, b, pairKey, distanceNm, {
    domain: "AIR",
    category: "AIR_HIGH",
    horizonSeconds: t.horizonSeconds,
    limitNm: t.highLimitNm,
    verticalFt: t.highVerticalFt,
    useMeters: false,
  });
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

function predict(
  track: MovementTrack,
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
