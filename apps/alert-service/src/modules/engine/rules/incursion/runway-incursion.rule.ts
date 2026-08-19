import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import { pointInPolygon } from "../geometry/geometry";

interface RunwayConfig {
  id: string;
  active: boolean;
  polygon: [number, number][];
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
    const candidates: AlertCandidate[] = [];

    for (const track of ctx.tracks) {
      for (const runway of activeRunways) {
        if (
          !pointInPolygon([track.latitude, track.longitude], runway.polygon)
        ) {
          continue;
        }

        const alertId = `RUNWAY_INCURSION|${ctx.airportId}|${track.trackId}-${runway.id}`;
        candidates.push({
          alertId,
          airportId: ctx.airportId,
          type: "RUNWAY_INCURSION",
          severity: "CRITICAL",
          status: "ACTIVE",
          trackId: track.trackId,
          triggeredAt: ctx.timestamp,
          data: {
            runwayId: runway.id,
            latitude: track.latitude,
            longitude: track.longitude,
          },
        });
      }
    }

    return candidates;
  },
};
