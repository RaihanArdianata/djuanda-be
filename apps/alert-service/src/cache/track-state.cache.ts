import { logger } from "@repo/logger";
import type { MovementTrack } from "../modules/engine/types";
import { redis } from "../redis/client";

export function trackKey(airportId: string, trackId: string): string {
  return `track:${airportId}:${trackId}`;
}

export async function saveTrackState(track: MovementTrack): Promise<void> {
  try {
    await redis.set(
      trackKey(track.airportId, track.trackId),
      JSON.stringify(track),
      "EX",
      300,
    );
  } catch (err) {
    logger.warn({ err, trackId: track.trackId }, "saveTrackState failed");
  }
}

export async function getTrackState(
  airportId: string,
  trackId: string,
): Promise<MovementTrack | null> {
  try {
    const raw = await redis.get(trackKey(airportId, trackId));
    if (!raw) return null;
    return JSON.parse(raw) as MovementTrack;
  } catch (err) {
    logger.warn({ err, airportId, trackId }, "getTrackState failed");
    return null;
  }
}

export async function getAllTrackStates(
  airportId: string,
): Promise<MovementTrack[]> {
  try {
    const pattern = `track:${airportId}:*`;
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, found] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = next;
      keys.push(...found);
    } while (cursor !== "0");

    if (keys.length === 0) return [];
    const values = await redis.mget(...keys);
    return values
      .filter((v: string | null): v is string => v !== null)
      .map((v: string) => JSON.parse(v) as MovementTrack);
  } catch (err) {
    logger.warn({ err, airportId }, "getAllTrackStates failed");
    return [];
  }
}
