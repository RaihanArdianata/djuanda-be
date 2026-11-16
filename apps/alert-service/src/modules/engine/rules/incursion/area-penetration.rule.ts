import { isIdentified, isOnSurface } from "../../policy/identity";
import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import { readableName } from "../geometry/feature-name";
import { insideBy } from "../geometry/geometry";

/**
 * Area Penetration: target di permukaan memasuki area terbatas.
 *
 *  - CRITICAL: target ber-identitas memasuki area berstatus `criticalAreaStatuses` (bawaan CLOSED: landasan atau area yang ditutup) dengan
 *    kecepatan sedikitnya `criticalMovingKt`, yaitu sedang melintasinya.
 *  - WARNING: target ber-identitas berada di area terbatas (RESTRICTED) setelah `confirmSeconds`.
 *  - INFO: target tanpa identitas di area terbatas setelah `unidentifiedConfirmSeconds`. Tidak perlu tindakan.
 *
 * Target dihitung di dalam area hanya bila sedikitnya `enterMarginM` dari tepinya, supaya goyangan posisi di garis batas tidak memicu alert
 * berulang.
 */

interface AreaConfig {
  id: string;
  name?: string | null;
  status?: string | null;
  type: string;
  polygon: [number, number][];
}

const DEFAULTS = {
  enterMarginM: 5,
  confirmSeconds: 5,
  unidentifiedConfirmSeconds: 15,
  criticalMovingKt: 15,
  criticalAreaStatuses: ["CLOSED"] as readonly string[],
} as const;

const positive = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

function criticalStatuses(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return DEFAULTS.criticalAreaStatuses;
  return value.filter((v): v is string => typeof v === "string");
}

interface Params {
  marginM: number;
  confirmS: number;
  unidentifiedS: number;
  criticalKt: number;
  criticalAreas: readonly string[];
}

function paramsFrom(config: Record<string, unknown>): Params {
  return {
    marginM: positive(config.enterMarginM, DEFAULTS.enterMarginM),
    confirmS: positive(config.confirmSeconds, DEFAULTS.confirmSeconds),
    unidentifiedS: positive(
      config.unidentifiedConfirmSeconds,
      DEFAULTS.unidentifiedConfirmSeconds,
    ),
    criticalKt: positive(config.criticalMovingKt, DEFAULTS.criticalMovingKt),
    criticalAreas: criticalStatuses(config.criticalAreaStatuses),
  };
}

type Severity = "INFO" | "WARNING" | "CRITICAL";

function severityOf(
  track: AlertContext["tracks"][number],
  status: string,
  p: Params,
): Severity {
  if (!isIdentified(track)) return "INFO";
  const crossingClosed =
    p.criticalAreas.includes(status) &&
    (track.groundSpeed ?? 0) >= p.criticalKt;
  return crossingClosed ? "CRITICAL" : "WARNING";
}

function buildCandidate(
  track: AlertContext["tracks"][number],
  area: AreaConfig,
  ctx: AlertContext,
  p: Params,
): AlertCandidate {
  const callsign = track.callsign ?? track.trackId;
  const featureName = readableName(area.name);
  const featureStatus = area.status ?? "RESTRICTED";
  const identified = isIdentified(track);

  return {
    alertId: `AREA_PENETRATION|${ctx.airportId}|${track.trackId}-${area.id}`,
    airportId: ctx.airportId,
    type: "AREA_PENETRATION",
    severity: severityOf(track, featureStatus, p),
    status: "ACTIVE",
    trackId: track.trackId,
    aerodromeFeatureId: area.id,
    triggeredAt: ctx.timestamp,
    confirmSeconds: identified ? p.confirmS : p.unidentifiedS,
    data: {
      track,
      area,
      areaId: area.id,
      areaName: featureName ?? null,
      areaType: area.type,
      areaStatus: featureStatus,
      callsign,
      message: `${callsign} entered restricted area${featureName ? ` ${featureName}` : ""} (${featureStatus})`,
      latitude: track.latitude,
      longitude: track.longitude,
    },
  };
}

export const areaPenetrationRule: DetectionRule = {
  type: "AREA_PENETRATION",
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const areas =
      (config.areas as AreaConfig[] | undefined) ?? ctx.aerodrome?.areas ?? [];
    const p = paramsFrom(config);
    const candidates: AlertCandidate[] = [];

    for (const track of ctx.tracks.filter(isOnSurface)) {
      const point: [number, number] = [track.latitude, track.longitude];
      for (const area of areas) {
        if (insideBy(point, area.polygon, p.marginM)) {
          candidates.push(buildCandidate(track, area, ctx, p));
        }
      }
    }
    return candidates;
  },
};
