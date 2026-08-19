import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import {
  distanceToPolylineMeters,
  haversineMeters,
} from "../geometry/geometry";

export const deviationRule: DetectionRule = {
  type: "DEVIATION",
  // biome-ignore-start lint/complexity/noExcessiveCognitiveComplexity: deviation logic
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const expectedRoute =
      (config.expectedRoute as [number, number][] | undefined) ?? [];
    const maxDistanceMeters =
      (config.maxDistanceMeters as number | undefined) ?? 500;
    const maxAltitudeDeviationFt =
      (config.maxAltitudeDeviationFt as number | undefined) ?? 300;

    if (expectedRoute.length === 0) return [];

    const candidates: AlertCandidate[] = [];

    for (const track of ctx.tracks) {
      const point: [number, number] = [track.latitude, track.longitude];
      const horizontalDistance = distanceToPolylineMeters(point, expectedRoute);

      const altitude = track.altitude ?? 0;
      const altitudeExceeded = Math.abs(altitude) > maxAltitudeDeviationFt;

      const maxTimeDeviation =
        (config.maximumTimeDeviation as number | undefined) ?? Infinity;
      let timeDeviationSeconds = 0;
      let timeExceeded = false;

      if (
        maxTimeDeviation !== Infinity &&
        Array.isArray(config.expectedRouteTimes) &&
        expectedRoute.length > 0
      ) {
        let nearestIndex = 0;
        let minDist = Infinity;
        for (let i = 0; i < expectedRoute.length; i++) {
          const d = haversineMeters(point, expectedRoute[i]);
          if (d < minDist) {
            minDist = d;
            nearestIndex = i;
          }
        }
        const expectedTimeStr = config.expectedRouteTimes[nearestIndex];
        if (typeof expectedTimeStr === "string") {
          const expectedTime = new Date(expectedTimeStr);
          if (!Number.isNaN(expectedTime.getTime())) {
            timeDeviationSeconds =
              Math.abs(track.timestamp.getTime() - expectedTime.getTime()) /
              1000;
            timeExceeded = timeDeviationSeconds > maxTimeDeviation;
          }
        }
      }

      if (
        horizontalDistance <= maxDistanceMeters &&
        !altitudeExceeded &&
        !timeExceeded
      ) {
        continue;
      }

      const alertId = `DEVIATION|${ctx.airportId}|${track.trackId}`;
      candidates.push({
        alertId,
        airportId: ctx.airportId,
        type: "DEVIATION",
        severity: "WARNING",
        status: "ACTIVE",
        trackId: track.trackId,
        triggeredAt: ctx.timestamp,
        data: {
          horizontalDistanceMeters: horizontalDistance,
          maxDistanceMeters,
          altitudeDeviationFt: altitude,
          maxAltitudeDeviationFt,
          timeDeviationSeconds,
          maximumTimeDeviation:
            maxTimeDeviation === Infinity ? null : maxTimeDeviation,
          timeExceeded,
          latitude: track.latitude,
          longitude: track.longitude,
        },
      });
    }

    return candidates;
  },
  // biome-ignore-end lint/complexity/noExcessiveCognitiveComplexity: deviation logic
};
