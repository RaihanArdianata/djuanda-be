import { getTrackHistory, type TrackHistoryRecord } from "../../track-history";
import type {
  AlertCandidate,
  AlertContext,
  DetectionRule,
  MovementTrack,
} from "../../types";
import {
  distanceToPolylineMeters,
  haversineMeters,
  pointInPolygon,
} from "../geometry/geometry";

interface SurfaceConfig {
  id: string;
  name?: string | null;
  status?: string | null;
  active?: boolean;
  type: "TAXIWAY" | "APRON" | string;
  polygon: [number, number][];
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
    severity: "WARNING",
    status: "ACTIVE",
    trackId: track.trackId,
    triggeredAt: ctx.timestamp,
    data: {
      reason: "OFF_ROUTE",
      distanceMeters: distance,
      maxDistanceMeters,
      latitude: track.latitude,
      longitude: track.longitude,
    },
  };
}

function isTrackEnteringSurface(
  track: MovementTrack,
  polygon: [number, number][],
): boolean {
  const history = getTrackHistory(track.trackId, 5);
  if (history.length < 2) return true;
  const previous = history[history.length - 2] as TrackHistoryRecord;
  return !pointInPolygon([previous.latitude, previous.longitude], polygon);
}

function buildSurfaceCandidate(
  track: MovementTrack,
  surface: SurfaceConfig,
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  relatedTrack?: MovementTrack,
  criticalMeters?: number,
): AlertCandidate {
  const callsign = track.callsign ?? track.trackId;
  const relatedCallsign = relatedTrack
    ? (relatedTrack.callsign ?? relatedTrack.trackId)
    : undefined;
  const featureName = surface.name ?? surface.id;
  const featureStatus = surface.status ?? "ACTIVE";
  const relatedText = relatedCallsign
    ? ` yang sedang dipakai ${relatedCallsign}`
    : "";

  let severity: "WARNING" | "CRITICAL" = "WARNING";
  let distanceMeters: number | null = null;
  if (relatedTrack && criticalMeters !== undefined) {
    distanceMeters = haversineMeters(
      [track.latitude, track.longitude],
      [relatedTrack.latitude, relatedTrack.longitude],
    );
    if (distanceMeters <= criticalMeters) {
      severity = "CRITICAL";
    }
  }

  return {
    alertId: `TAXIWAY_APRON_INCURSION|${ctx.airportId}|${track.trackId}-${surface.id}`,
    airportId: ctx.airportId,
    type: "TAXIWAY_APRON_INCURSION",
    severity,
    status: "ACTIVE",
    trackId: track.trackId,
    relatedTrackId: relatedTrack?.trackId,
    aerodromeFeatureId: surface.id,
    triggeredAt: ctx.timestamp,
    data: {
      track,
      relatedTrack,
      surface,
      surfaceId: surface.id,
      surfaceName: featureName,
      surfaceType: surface.type,
      surfaceStatus: featureStatus,
      callsign,
      relatedCallsign,
      distanceMeters,
      criticalMeters,
      message: `${callsign} memasuki ${featureName}${relatedText}`,
      latitude: track.latitude,
      longitude: track.longitude,
    },
  };
}

function evaluateSurfaces(
  surfaces: SurfaceConfig[],
  tracks: MovementTrack[],
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
  config: Record<string, unknown>,
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];
  const criticalMeters =
    (config.criticalSeparationMeters as number | undefined) ?? 50;

  for (const surface of surfaces) {
    const inside = tracks.filter(
      (t) =>
        t.onGround !== false &&
        pointInPolygon([t.latitude, t.longitude], surface.polygon),
    );
    if (inside.length === 0) continue;

    if (inside.length === 1) {
      candidates.push(buildSurfaceCandidate(inside[0], surface, ctx));
      continue;
    }

    const entrants = inside.filter((t) =>
      isTrackEnteringSurface(t, surface.polygon),
    );
    const occupants = inside.filter(
      (t) => !isTrackEnteringSurface(t, surface.polygon),
    );
    const occupant = occupants[0] ?? inside[0];

    const intruders =
      entrants.length > 0
        ? entrants
        : inside.filter((t) => t.trackId !== occupant.trackId);

    for (const intruder of intruders) {
      if (intruder.trackId === occupant.trackId) continue;
      candidates.push(
        buildSurfaceCandidate(intruder, surface, ctx, occupant, criticalMeters),
      );
    }
  }

  return candidates;
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
        if (track.onGround === false) continue;
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
