import { logger } from "@repo/logger";
import { publishToTopic } from "@repo/shared/sse/publisher";
import type { AerodromeContextData } from "./types";

/** State terakhir yang sudah dibroadcast per airport, supaya kita hanya
 *  publish saat ada perubahan (bukan setiap track update). */
const lastActiveIds = new Map<string, string>();

function activeIdsKey(aerodrome: AerodromeContextData): string {
  const runwayIds = aerodrome.runways
    .filter((r) => r.active)
    .map((r) => r.id)
    .sort();
  const surfaceIds = aerodrome.surfaces
    .filter((s) => s.active)
    .map((s) => s.id)
    .sort();
  return JSON.stringify({ runwayIds, surfaceIds });
}

/**
 * Broadcast status aktif (occupied) runway/taxiway/apron ke topic SSE
 * "aerodrome" — frontend hanya consume, tidak menghitung geometry sendiri.
 */
export async function broadcastAerodromeStatus(
  airportId: string,
  aerodrome: AerodromeContextData | null,
): Promise<void> {
  if (!aerodrome) return;

  const key = activeIdsKey(aerodrome);
  if (lastActiveIds.get(airportId) === key) return;
  lastActiveIds.set(airportId, key);

  const payload = {
    eventType: "AERODROME_STATUS_UPDATED",
    timestamp: new Date().toISOString(),
    airportId,
    runways: aerodrome.runways.map((r) => ({ id: r.id, active: r.active })),
    surfaces: aerodrome.surfaces.map((s) => ({ id: s.id, active: s.active })),
  };

  try {
    await publishToTopic("aerodrome", JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err, airportId }, "failed to broadcast aerodrome status");
  }
}
