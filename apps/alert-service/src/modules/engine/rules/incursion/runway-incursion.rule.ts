import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import { pointInPolygon } from "../geometry/geometry";

interface RunwayConfig {
  id: string;
  name?: string | null;
  status?: string | null;
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
      if (track.onGround === false) continue;
      for (const runway of activeRunways) {
        if (
          !pointInPolygon([track.latitude, track.longitude], runway.polygon)
        ) {
          continue;
        }

        const alertId = `RUNWAY_INCURSION|${ctx.airportId}|${track.trackId}-${runway.id}`;
        const callsign = track.callsign ?? track.trackId;
        const featureName = runway.name ?? runway.id;
        const featureStatus = runway.status ?? "ACTIVE";

        candidates.push({
          alertId,
          airportId: ctx.airportId,
          type: "RUNWAY_INCURSION",
          severity: "CRITICAL",
          status: "ACTIVE",
          trackId: track.trackId,
          aerodromeFeatureId: runway.id,
          triggeredAt: ctx.timestamp,
          data: {
            track,
            runway,
            runwayId: runway.id,
            runwayName: featureName,
            runwayStatus: featureStatus,
            active: runway.active,
            callsign,
            message: `${callsign} entered runway ${featureName} (${featureStatus})`,
            latitude: track.latitude,
            longitude: track.longitude,
          },
        });
      }
    }

    return candidates;
  },
};
