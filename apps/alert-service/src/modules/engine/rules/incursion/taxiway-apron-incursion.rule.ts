import type {
  AlertCandidate,
  AlertContext,
  DetectionRule,
  MovementTrack,
} from "../../types";
import { distanceToPolylineMeters, pointInPolygon } from "../geometry/geometry";

interface SurfaceConfig {
  id: string;
  name?: string | null;
  status?: string | null;
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

function checkSurface(
  track: MovementTrack,
  surface: SurfaceConfig,
  ctx: Pick<AlertContext, "airportId" | "timestamp">,
): AlertCandidate | null {
  const point: [number, number] = [track.latitude, track.longitude];

  if (!pointInPolygon(point, surface.polygon)) {
    return null;
  }

  const callsign = track.callsign ?? track.trackId;
  const featureName = surface.name ?? surface.id;
  const featureStatus = surface.status ?? "ACTIVE";

  return {
    alertId: `TAXIWAY_APRON_INCURSION|${ctx.airportId}|${track.trackId}-${surface.id}`,
    airportId: ctx.airportId,
    type: "TAXIWAY_APRON_INCURSION",
    severity: "WARNING",
    status: "ACTIVE",
    trackId: track.trackId,
    aerodromeFeatureId: surface.id,
    triggeredAt: ctx.timestamp,
    data: {
      track,
      surface,
      surfaceId: surface.id,
      surfaceName: featureName,
      surfaceType: surface.type,
      surfaceStatus: featureStatus,
      callsign,
      message: `${callsign} entered ${featureName} (${featureStatus})`,
      latitude: track.latitude,
      longitude: track.longitude,
    },
  };
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
    const candidates: AlertCandidate[] = [];

    for (const track of ctx.tracks) {
      if (expectedRoute.length > 0) {
        const offRouteCandidate = checkOffRoute(
          track,
          expectedRoute,
          maxDistanceMeters,
          ctx,
        );
        if (offRouteCandidate) {
          candidates.push(offRouteCandidate);
        }
        continue;
      }

      for (const surface of surfaces) {
        const surfaceCandidate = checkSurface(track, surface, ctx);
        if (surfaceCandidate) {
          candidates.push(surfaceCandidate);
        }
      }
    }

    return candidates;
  },
};
