import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import { distanceToPolylineMeters, pointInPolygon } from "../geometry/geometry";

interface SurfaceConfig {
  id: string;
  type: "TAXIWAY" | "APRON" | string;
  polygon: [number, number][];
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
      const point: [number, number] = [track.latitude, track.longitude];

      if (expectedRoute.length > 0) {
        const distance = distanceToPolylineMeters(point, expectedRoute);
        if (distance <= maxDistanceMeters) {
          continue;
        }

        const alertId = `TAXIWAY_APRON_INCURSION|${ctx.airportId}|${track.trackId}-ROUTE`;
        candidates.push({
          alertId,
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
        });
        continue;
      }

      for (const surface of surfaces) {
        if (!pointInPolygon(point, surface.polygon)) continue;

        const alertId = `TAXIWAY_APRON_INCURSION|${ctx.airportId}|${track.trackId}-${surface.id}`;
        candidates.push({
          alertId,
          airportId: ctx.airportId,
          type: "TAXIWAY_APRON_INCURSION",
          severity: "WARNING",
          status: "ACTIVE",
          trackId: track.trackId,
          triggeredAt: ctx.timestamp,
          data: {
            surfaceId: surface.id,
            surfaceType: surface.type,
            latitude: track.latitude,
            longitude: track.longitude,
          },
        });
      }
    }

    return candidates;
  },
};
