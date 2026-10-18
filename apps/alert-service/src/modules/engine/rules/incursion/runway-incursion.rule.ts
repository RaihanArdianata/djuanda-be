import { getTrackHistory, type TrackHistoryRecord } from "../../track-history";
import type {
  AlertCandidate,
  AlertContext,
  DetectionRule,
  MovementTrack,
} from "../../types";
import { pointInPolygon } from "../geometry/geometry";

interface RunwayConfig {
  id: string;
  name?: string | null;
  status?: string | null;
  active: boolean;
  polygon: [number, number][];
}

/** Track tanpa flag onGround tapi altitude MSL di atas ini jelas airborne. */
const AIRBORNE_ALTITUDE_FT = 500;

function isOnSurface(t: MovementTrack): boolean {
  if (t.onGround === false) return false;
  if (
    t.onGround === undefined &&
    t.altitude !== undefined &&
    t.altitude > AIRBORNE_ALTITUDE_FT
  )
    return false;
  return true;
}

/** Cek apakah track baru masuk ke runway (titik sebelumnya di luar polygon). */
function isTrackEnteringRunway(
  track: MovementTrack,
  polygon: [number, number][],
): boolean {
  const history = getTrackHistory(track.trackId, 5);
  if (history.length < 2) return true;
  const previous = history[history.length - 2] as TrackHistoryRecord;
  return !pointInPolygon([previous.latitude, previous.longitude], polygon);
}

function buildRunwayCandidate(
  intruder: MovementTrack,
  occupant: MovementTrack,
  runway: RunwayConfig,
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
): AlertCandidate {
  const callsign = intruder.callsign ?? intruder.trackId;
  const occupantCallsign = occupant.callsign ?? occupant.trackId;
  const featureName = runway.name ?? runway.id;
  const featureStatus = runway.status ?? "ACTIVE";

  return {
    alertId: `RUNWAY_INCURSION|${ctx.airportId}|${intruder.trackId}-${runway.id}`,
    airportId: ctx.airportId,
    type: "RUNWAY_INCURSION",
    severity: "CRITICAL",
    status: "ACTIVE",
    trackId: intruder.trackId,
    relatedTrackId: occupant.trackId,
    aerodromeFeatureId: runway.id,
    triggeredAt: ctx.timestamp,
    data: {
      track: intruder,
      relatedTrack: occupant,
      runway,
      runwayId: runway.id,
      runwayName: featureName,
      runwayStatus: featureStatus,
      active: runway.active,
      callsign,
      relatedCallsign: occupantCallsign,
      message: `${callsign} memasuki runway ${featureName} yang sedang dipakai ${occupantCallsign} (${featureStatus})`,
      latitude: intruder.latitude,
      longitude: intruder.longitude,
    },
  };
}

function collectRunwayCandidates(
  runway: RunwayConfig,
  tracks: MovementTrack[],
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
): AlertCandidate[] {
  const inside = tracks.filter(
    (t) =>
      isOnSurface(t) &&
      pointInPolygon([t.latitude, t.longitude], runway.polygon),
  );
  if (inside.length < 2) return [];

  const entrants = inside.filter((t) =>
    isTrackEnteringRunway(t, runway.polygon),
  );
  const occupants = inside.filter(
    (t) => !isTrackEnteringRunway(t, runway.polygon),
  );
  const occupant = occupants[0] ?? inside[0];

  const intruders =
    entrants.length > 0
      ? entrants
      : inside.filter((t) => t.trackId !== occupant.trackId);

  const candidates: AlertCandidate[] = [];
  for (const intruder of intruders) {
    if (intruder.trackId === occupant.trackId) continue;
    candidates.push(buildRunwayCandidate(intruder, occupant, runway, ctx));
  }
  return candidates;
}

function evaluateRunways(
  runways: RunwayConfig[],
  tracks: MovementTrack[],
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  for (const runway of runways) {
    candidates.push(...collectRunwayCandidates(runway, tracks, ctx));
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
    return evaluateRunways(activeRunways, ctx.tracks, ctx);
  },
};
