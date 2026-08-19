import type { AlertCandidate, AlertContext, DetectionRule } from "../../types";
import { pointInPolygon } from "../geometry/geometry";

interface AreaConfig {
  id: string;
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
      for (const area of areas) {
        if (!pointInPolygon([track.latitude, track.longitude], area.polygon)) {
          continue;
        }

        const alertId = `AREA_PENETRATION|${ctx.airportId}|${track.trackId}-${area.id}`;
        candidates.push({
          alertId,
          airportId: ctx.airportId,
          type: "AREA_PENETRATION",
          severity: "WARNING",
          status: "ACTIVE",
          trackId: track.trackId,
          triggeredAt: ctx.timestamp,
          data: {
            areaId: area.id,
            areaType: area.type,
            latitude: track.latitude,
            longitude: track.longitude,
          },
        });
      }
    }

    return candidates;
  },
};
