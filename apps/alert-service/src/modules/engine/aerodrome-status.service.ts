import { logger } from "@repo/logger";
import { publishToTopic } from "@repo/shared/sse/publisher";
import type { AerodromeContextData } from "./types";

const HEARTBEAT_MS = 15_000;
const lastBroadcast = new Map<string, { key: string; at: number }>();

function activeIdsKey(aerodrome: AerodromeContextData): string {
  // Key mencakup aircraftIds — pergantian penghuni polygon (A keluar, B masuk)
  // juga dianggap perubahan state yang layak di-broadcast.
  return JSON.stringify(
    (aerodrome.occupancy ?? [])
      .filter((o) => o.status === "OCCUPIED")
      .map((o) => [o.polygonId, o.aircraftIds.sort()]),
  );
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
  const last = lastBroadcast.get(airportId);
  const now = Date.now();
  if (last && last.key === key && now - last.at < HEARTBEAT_MS) return;
  lastBroadcast.set(airportId, { key, at: now });

  const payload = {
    eventType: "AERODROME_STATUS_UPDATED",
    timestamp: new Date().toISOString(),
    airportId,
    // Generic occupancy untuk semua polygon aerodrome (runway, taxiway,
    // apron, dan layer polygon lainnya) — FE hanya consume, tidak menghitung
    // geometry sendiri.
    features: (aerodrome.occupancy ?? []).map((o) => ({
      id: o.polygonId,
      type: o.type,
      status: o.status,
      active: o.status === "OCCUPIED",
      aircraftIds: o.aircraftIds,
      aircraftCount: o.aircraftCount,
    })),
    // Legacy shape — tetap dikirim untuk kompatibilitas consumer lama.
    runways: aerodrome.runways.map((r) => ({ id: r.id, active: r.active })),
    surfaces: aerodrome.surfaces.map((s) => ({ id: s.id, active: s.active })),
  };

  try {
    await publishToTopic("aerodrome", JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err, airportId }, "failed to broadcast aerodrome status");
  }
}
