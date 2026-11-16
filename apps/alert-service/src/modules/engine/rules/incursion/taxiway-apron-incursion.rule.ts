import {
  isIdentified,
  isMovingAbove,
  isOnSurface,
} from "../../policy/identity";
import type {
  AlertCandidate,
  AlertContext,
  DetectionRule,
  MovementTrack,
} from "../../types";
import { readableName } from "../geometry/feature-name";
import {
  distanceToPolylineMeters,
  haversineMeters,
  insideBy,
} from "../geometry/geometry";
import { approach } from "../geometry/motion";

/**
 * Taxiway/Apron Incursion. Dua pesawat di taxiway atau apron yang sama itu normal (mengikuti di taxiway, parkir berdampingan di stand), jadi
 * keberadaan bersama TIDAK menjadi alert. Yang dinilai adalah bahaya:
 *
 *  - CRITICAL: dua target ber-identitas, salah satunya bergerak, yang dalam `closingHorizonSeconds` ke depan akan sedekat `criticalSeparationMeters`
 *    atau kurang (mendekat).
 *  - WARNING: dua target ber-identitas, salah satunya bergerak, saling mendekat dan sudah dalam `warningSeparationMeters` (taxiway) atau
 *    `apronWarningSeparationMeters` (apron). Atau target ber-identitas di permukaan berstatus INACTIVE/RESTRICTED.
 *  - INFO: hal yang sama, tetapi salah satu pihaknya tanpa identitas (bisa gema sensor atau kendaraan yang tidak melapor nama), setelah bertahan
 *    lebih lama. Tidak perlu tindakan.
 *
 * Tiap alert menunggu `confirmSeconds` (kondisi harus bertahan tanpa terputus) sebelum dibuat, dan target dianggap di dalam permukaan
 * hanya bila sedikitnya `enterMarginM` dari tepinya (goyangan di garis batas tidak dihitung masuk).
 */

interface SurfaceConfig {
  id: string;
  name?: string | null;
  status?: string | null;
  active?: boolean;
  type: "TAXIWAY" | "APRON" | string;
  polygon: [number, number][];
}

type Severity = "INFO" | "WARNING" | "CRITICAL";

const DEFAULTS = {
  criticalSeparationMeters: 25,
  warningSeparationMeters: 80,
  apronWarningSeparationMeters: 40,
  movingKt: 3,
  closingHorizonSeconds: 10,
  confirmSeconds: 3,
  restrictedConfirmSeconds: 5,
  unidentifiedConfirmSeconds: 15,
  routeConfirmSeconds: 10,
  enterMarginM: 3,
} as const;

interface Params {
  criticalM: number;
  taxiwayWarningM: number;
  apronWarningM: number;
  movingKt: number;
  horizonS: number;
  confirmS: number;
  restrictedConfirmS: number;
  unidentifiedConfirmS: number;
  enterMarginM: number;
}

/** Angka positif dari konfigurasi; selain itu `fallback`. */
function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function paramsFrom(config: Record<string, unknown>): Params {
  return {
    criticalM: positive(
      config.criticalSeparationMeters,
      DEFAULTS.criticalSeparationMeters,
    ),
    // `taxiwayProximityMeters` (pengaturan lama) tetap berlaku sebagai jarak peringatan di taxiway.
    taxiwayWarningM: positive(
      config.warningSeparationMeters,
      positive(config.taxiwayProximityMeters, DEFAULTS.warningSeparationMeters),
    ),
    apronWarningM: positive(
      config.apronWarningSeparationMeters,
      DEFAULTS.apronWarningSeparationMeters,
    ),
    movingKt: positive(config.movingKt, DEFAULTS.movingKt),
    horizonS: positive(
      config.closingHorizonSeconds,
      DEFAULTS.closingHorizonSeconds,
    ),
    confirmS: positive(config.confirmSeconds, DEFAULTS.confirmSeconds),
    restrictedConfirmS: positive(
      config.restrictedConfirmSeconds,
      DEFAULTS.restrictedConfirmSeconds,
    ),
    unidentifiedConfirmS: positive(
      config.unidentifiedConfirmSeconds,
      DEFAULTS.unidentifiedConfirmSeconds,
    ),
    enterMarginM: positive(config.enterMarginM, DEFAULTS.enterMarginM),
  };
}

function checkOffRoute(
  track: MovementTrack,
  expectedRoute: [number, number][],
  maxDistanceMeters: number,
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
): AlertCandidate | null {
  const point: [number, number] = [track.latitude, track.longitude];
  const distance = distanceToPolylineMeters(point, expectedRoute);

  if (distance <= maxDistanceMeters) {
    return null;
  }

  return {
    alertId: `TAXIWAY_APRON_INCURSION|${ctx.airportId}|${track.trackId}-ROUTE`,
    airportId: ctx.airportId,
    type: "TAXIWAY_APRON_INCURSION",
    severity: isIdentified(track) ? "WARNING" : "INFO",
    status: "ACTIVE",
    trackId: track.trackId,
    triggeredAt: ctx.timestamp,
    confirmSeconds: DEFAULTS.routeConfirmSeconds,
    data: {
      reason: "OFF_ROUTE",
      distanceMeters: distance,
      maxDistanceMeters,
      latitude: track.latitude,
      longitude: track.longitude,
    },
  };
}

interface CandidateInput {
  track: MovementTrack;
  surface: SurfaceConfig;
  ctx: Pick<AlertContext, "airportId" | "timestamp">;
  severity: Severity;
  confirmSeconds: number;
  reason: "CLOSING" | "RESTRICTED_ENTRY";
  related?: MovementTrack;
  distanceMeters?: number;
  closestMeters?: number;
  criticalMeters: number;
  warningMeters?: number;
}

function buildSurfaceCandidate(input: CandidateInput): AlertCandidate {
  const { track, surface, ctx, related } = input;
  const callsign = track.callsign ?? track.trackId;
  const relatedCallsign = related
    ? (related.callsign ?? related.trackId)
    : undefined;
  const featureName = readableName(surface.name);
  const featureStatus = surface.status ?? "ACTIVE";
  const relatedText = relatedCallsign
    ? ` yang sedang dipakai ${relatedCallsign}`
    : "";

  return {
    alertId: `TAXIWAY_APRON_INCURSION|${ctx.airportId}|${track.trackId}-${surface.id}`,
    airportId: ctx.airportId,
    type: "TAXIWAY_APRON_INCURSION",
    severity: input.severity,
    status: "ACTIVE",
    trackId: track.trackId,
    relatedTrackId: related?.trackId,
    aerodromeFeatureId: surface.id,
    triggeredAt: ctx.timestamp,
    confirmSeconds: input.confirmSeconds,
    data: {
      track,
      relatedTrack: related,
      surface,
      surfaceId: surface.id,
      surfaceName: featureName ?? null,
      surfaceType: surface.type,
      surfaceStatus: featureStatus,
      callsign,
      relatedCallsign,
      distanceMeters: input.distanceMeters ?? null,
      closestMeters: input.closestMeters ?? null,
      criticalMeters: input.criticalMeters,
      warningMeters: input.warningMeters ?? null,
      reason: input.reason,
      message: `${callsign} memasuki ${featureName ?? "taxiway/apron"}${relatedText}`,
      latitude: track.latitude,
      longitude: track.longitude,
    },
  };
}

/** Pelaku adalah yang bergerak lebih cepat; yang lain dianggap penghuni. */
function orderByMotion(
  a: MovementTrack,
  b: MovementTrack,
): [MovementTrack, MovementTrack] {
  return (a.groundSpeed ?? 0) >= (b.groundSpeed ?? 0) ? [a, b] : [b, a];
}

/** Dua target di permukaan yang sama: kandidat alert bila salah satunya bergerak, mereka saling mendekat, dan sudah dalam jarak peringatan. */
function judgePair(
  a: MovementTrack,
  b: MovementTrack,
  surface: SurfaceConfig,
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  p: Params,
): AlertCandidate | null {
  // Dua target yang sama-sama diam (parkir berdampingan, antre) tidak berbahaya.
  if (!isMovingAbove(a, p.movingKt) && !isMovingAbove(b, p.movingKt))
    return null;

  const warningM =
    surface.type === "APRON" ? p.apronWarningM : p.taxiwayWarningM;
  const ap = approach(a, b, p.horizonS);
  if (!ap.closing || ap.distanceM > warningM) return null;

  const identified = isIdentified(a) && isIdentified(b);
  const severity: Severity = !identified
    ? "INFO"
    : ap.closestM <= p.criticalM
      ? "CRITICAL"
      : "WARNING";
  const [intruder, occupant] = orderByMotion(a, b);
  return buildSurfaceCandidate({
    track: intruder,
    surface,
    ctx,
    severity,
    confirmSeconds: identified ? p.confirmS : p.unidentifiedConfirmS,
    reason: "CLOSING",
    related: occupant,
    distanceMeters: haversineMeters(
      [intruder.latitude, intruder.longitude],
      [occupant.latitude, occupant.longitude],
    ),
    closestMeters: ap.closestM,
    criticalMeters: p.criticalM,
    warningMeters: warningM,
  });
}

function collectConflicts(
  surface: SurfaceConfig,
  inside: MovementTrack[],
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  p: Params,
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  for (let i = 0; i < inside.length; i++) {
    for (let j = i + 1; j < inside.length; j++) {
      const candidate = judgePair(
        inside[i] as MovementTrack,
        inside[j] as MovementTrack,
        surface,
        ctx,
        p,
      );
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function collectRestricted(
  surface: SurfaceConfig,
  inside: MovementTrack[],
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  p: Params,
): AlertCandidate[] {
  return inside.map((track) => {
    const identified = isIdentified(track);
    return buildSurfaceCandidate({
      track,
      surface,
      ctx,
      severity: identified ? "WARNING" : "INFO",
      confirmSeconds: identified
        ? p.restrictedConfirmS
        : p.unidentifiedConfirmS,
      reason: "RESTRICTED_ENTRY",
      criticalMeters: p.criticalM,
    });
  });
}

const SEVERITY_ORDER: Record<string, number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
};

/** Satu candidate per alertId; bila ada dua (masuk area terlarang dan mendekat sekaligus), yang severity-nya lebih tinggi dipakai. */
function dedupe(candidates: AlertCandidate[]): AlertCandidate[] {
  const byId = new Map<string, AlertCandidate>();
  for (const c of candidates) {
    const known = byId.get(c.alertId);
    if (
      !known ||
      (SEVERITY_ORDER[c.severity] ?? 0) > (SEVERITY_ORDER[known.severity] ?? 0)
    ) {
      byId.set(c.alertId, c);
    }
  }
  return [...byId.values()];
}

function evaluateSurfaces(
  surfaces: SurfaceConfig[],
  tracks: MovementTrack[],
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  config: Record<string, unknown>,
): AlertCandidate[] {
  const p = paramsFrom(config);
  const candidates: AlertCandidate[] = [];

  for (const surface of surfaces) {
    const inside = tracks.filter(
      (t) =>
        isOnSurface(t) &&
        insideBy([t.latitude, t.longitude], surface.polygon, p.enterMarginM),
    );
    if (inside.length === 0) continue;

    const restricted =
      surface.status === "INACTIVE" || surface.status === "RESTRICTED";
    if (restricted)
      candidates.push(...collectRestricted(surface, inside, ctx, p));
    if (inside.length >= 2) {
      candidates.push(...collectConflicts(surface, inside, ctx, p));
    }
  }

  return dedupe(candidates);
}

export const taxiwayApronIncursionRule: DetectionRule = {
  type: "TAXIWAY_APRON_INCURSION",
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const surfaces =
      (config.surfaces as SurfaceConfig[] | undefined) ??
      ctx.aerodrome?.surfaces ??
      [];

    const expectedRoute =
      (config.expectedRoute as [number, number][] | undefined) ?? [];
    const maxDistanceMeters =
      (config.maxDistanceMeters as number | undefined) ?? 50;

    if (expectedRoute.length > 0) {
      const candidates: AlertCandidate[] = [];
      for (const track of ctx.tracks) {
        if (!isOnSurface(track)) continue;
        const offRoute = checkOffRoute(
          track,
          expectedRoute,
          maxDistanceMeters,
          ctx,
        );
        if (offRoute) candidates.push(offRoute);
      }
      return candidates;
    }

    return evaluateSurfaces(surfaces, ctx.tracks, ctx, config);
  },
};
