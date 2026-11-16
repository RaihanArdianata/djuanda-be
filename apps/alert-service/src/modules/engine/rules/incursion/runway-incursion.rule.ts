import { isIdentified, isOnSurface } from "../../policy/identity";
import { getTrackHistory, type TrackHistoryRecord } from "../../track-history";
import type {
  AlertCandidate,
  AlertContext,
  DetectionRule,
  MovementTrack,
} from "../../types";
import { readableName } from "../geometry/feature-name";
import { haversineMeters, insideBy } from "../geometry/geometry";

/**
 * Runway Incursion: dua target atau lebih berada di landasan aktif yang sama.
 *
 *  - CRITICAL: dua target ber-identitas di landasan yang sama, dan salah satunya melaju sedikitnya `criticalSpeedKt` (sedang lepas landas
 *    atau mendarat) atau keduanya berjarak paling jauh `criticalSeparationMeters`.
 *  - WARNING: dua target ber-identitas di landasan yang sama, tetapi pelan dan berjauhan (mis. kendaraan inspeksi dan pesawat yang backtrack).
 *  - INFO: salah satu pihaknya tanpa identitas (bisa gema sensor atau kendaraan yang tidak melapor nama) setelah
 *    `unidentifiedConfirmSeconds`. Satu target tanpa identitas yang sendirian di landasan hanya dilaporkan bila `reportUnidentifiedAlone` true.
 *
 * Alert dibuat setelah kondisinya bertahan `confirmSeconds` tanpa terputus.
 */

interface RunwayConfig {
  id: string;
  name?: string | null;
  status?: string | null;
  active: boolean;
  polygon: [number, number][];
}

const DEFAULTS = {
  enterMarginM: 3,
  confirmSeconds: 3,
  unidentifiedConfirmSeconds: 15,
  aloneConfirmSeconds: 10,
  criticalSpeedKt: 30,
  criticalSeparationMeters: 500,
} as const;

interface Params {
  marginM: number;
  confirmS: number;
  unidentifiedS: number;
  aloneS: number;
  criticalKt: number;
  criticalM: number;
  reportAlone: boolean;
}

const positive = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

function paramsFrom(config: Record<string, unknown>): Params {
  return {
    marginM: positive(config.enterMarginM, DEFAULTS.enterMarginM),
    confirmS: positive(config.confirmSeconds, DEFAULTS.confirmSeconds),
    unidentifiedS: positive(
      config.unidentifiedConfirmSeconds,
      DEFAULTS.unidentifiedConfirmSeconds,
    ),
    aloneS: positive(config.aloneConfirmSeconds, DEFAULTS.aloneConfirmSeconds),
    criticalKt: positive(config.criticalSpeedKt, DEFAULTS.criticalSpeedKt),
    criticalM: positive(
      config.criticalSeparationMeters,
      DEFAULTS.criticalSeparationMeters,
    ),
    reportAlone: config.reportUnidentifiedAlone === true,
  };
}

/** Cek apakah track baru masuk ke runway (titik sebelumnya di luar polygon). */
function isTrackEnteringRunway(
  track: MovementTrack,
  polygon: [number, number][],
): boolean {
  const history = getTrackHistory(track.trackId, 5);
  if (history.length < 2) return true;
  const previous = history[history.length - 2] as TrackHistoryRecord;
  return !insideBy([previous.latitude, previous.longitude], polygon, 0);
}

type Severity = "INFO" | "WARNING" | "CRITICAL";

interface Verdict {
  severity: Severity;
  confirmSeconds: number;
}

/** Severity sepasang target di landasan yang sama. */
function judgePair(
  intruder: MovementTrack,
  occupant: MovementTrack,
  p: Params,
): Verdict {
  if (!isIdentified(intruder) || !isIdentified(occupant)) {
    return { severity: "INFO", confirmSeconds: p.unidentifiedS };
  }
  const fastest = Math.max(
    intruder.groundSpeed ?? 0,
    occupant.groundSpeed ?? 0,
  );
  const apart = haversineMeters(
    [intruder.latitude, intruder.longitude],
    [occupant.latitude, occupant.longitude],
  );
  const severity: Severity =
    fastest >= p.criticalKt || apart <= p.criticalM ? "CRITICAL" : "WARNING";
  return { severity, confirmSeconds: p.confirmS };
}

function buildRunwayCandidate(
  intruder: MovementTrack,
  occupant: MovementTrack | undefined,
  runway: RunwayConfig,
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  verdict: Verdict,
): AlertCandidate {
  const callsign = intruder.callsign ?? intruder.trackId;
  const occupantCallsign = occupant
    ? (occupant.callsign ?? occupant.trackId)
    : undefined;
  const featureName = readableName(runway.name);
  const featureStatus = runway.status ?? "ACTIVE";
  const occupantText = occupantCallsign
    ? ` yang sedang dipakai ${occupantCallsign}`
    : "";

  return {
    alertId: `RUNWAY_INCURSION|${ctx.airportId}|${intruder.trackId}-${runway.id}`,
    airportId: ctx.airportId,
    type: "RUNWAY_INCURSION",
    severity: verdict.severity,
    status: "ACTIVE",
    trackId: intruder.trackId,
    relatedTrackId: occupant?.trackId,
    aerodromeFeatureId: runway.id,
    triggeredAt: ctx.timestamp,
    confirmSeconds: verdict.confirmSeconds,
    data: {
      track: intruder,
      relatedTrack: occupant,
      runway,
      runwayId: runway.id,
      runwayName: featureName ?? null,
      runwayStatus: featureStatus,
      active: runway.active,
      callsign,
      relatedCallsign: occupantCallsign,
      message: `${callsign} memasuki runway${featureName ? ` ${featureName}` : ""}${occupantText} (${featureStatus})`,
      latitude: intruder.latitude,
      longitude: intruder.longitude,
    },
  };
}

function collectRunwayCandidates(
  runway: RunwayConfig,
  tracks: MovementTrack[],
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  p: Params,
): AlertCandidate[] {
  const inside = tracks.filter(
    (t) =>
      isOnSurface(t) &&
      insideBy([t.latitude, t.longitude], runway.polygon, p.marginM),
  );

  if (inside.length === 1) {
    const only = inside[0] as MovementTrack;
    if (p.reportAlone && !isIdentified(only)) {
      return [
        buildRunwayCandidate(only, undefined, runway, ctx, {
          severity: "INFO",
          confirmSeconds: p.aloneS,
        }),
      ];
    }
    return [];
  }
  if (inside.length < 2) return [];

  const entrants = inside.filter((t) =>
    isTrackEnteringRunway(t, runway.polygon),
  );
  const occupants = inside.filter(
    (t) => !isTrackEnteringRunway(t, runway.polygon),
  );
  const occupant = (occupants[0] ?? inside[0]) as MovementTrack;

  const intruders =
    entrants.length > 0
      ? entrants
      : inside.filter((t) => t.trackId !== occupant.trackId);

  const candidates: AlertCandidate[] = [];
  for (const intruder of intruders) {
    if (intruder.trackId === occupant.trackId) continue;
    candidates.push(
      buildRunwayCandidate(
        intruder,
        occupant,
        runway,
        ctx,
        judgePair(intruder, occupant, p),
      ),
    );
  }
  return candidates;
}

function evaluateRunways(
  runways: RunwayConfig[],
  tracks: MovementTrack[],
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  p: Params,
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  for (const runway of runways) {
    candidates.push(...collectRunwayCandidates(runway, tracks, ctx, p));
  }
  return candidates;
}

export const runwayIncursionRule: DetectionRule = {
  type: "RUNWAY_INCURSION",
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const runways =
      (config.runways as RunwayConfig[] | undefined) ??
      ctx.aerodrome?.runways ??
      [];
    const activeRunways = runways.filter((r) => r.active);
    return evaluateRunways(activeRunways, ctx.tracks, ctx, paramsFrom(config));
  },
};
