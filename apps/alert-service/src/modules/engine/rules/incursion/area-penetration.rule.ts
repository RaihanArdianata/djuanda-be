import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import { readableName } from "../geometry/feature-name";
import { pointInPolygon } from "../geometry/geometry";

interface AreaConfig {
  id: string;
  name?: string | null;
  status?: string | null;
  type: string;
  polygon: [number, number][];
}

export const areaPenetrationRule: DetectionRule = {
  type: "AREA_PENETRATION",
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ): AlertCandidate[] => {
    const areas =
      (config.areas as AreaConfig[] | undefined) ?? ctx.aerodrome?.areas ?? [];

    const candidates: AlertCandidate[] = [];

    for (const track of ctx.tracks) {
      if (track.onGround === false) continue;
      for (const area of areas) {
        if (!pointInPolygon([track.latitude, track.longitude], area.polygon)) {
          continue;
        }

        const alertId = `AREA_PENETRATION|${ctx.airportId}|${track.trackId}-${area.id}`;
        const callsign = track.callsign ?? track.trackId;
        const featureName = readableName(area.name);
        const featureStatus = area.status ?? "RESTRICTED";

        candidates.push({
          alertId,
          airportId: ctx.airportId,
          type: "AREA_PENETRATION",
          severity: "WARNING",
          status: "ACTIVE",
          trackId: track.trackId,
          aerodromeFeatureId: area.id,
          triggeredAt: ctx.timestamp,
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
        });
      }
    }

    return candidates;
  },
};
