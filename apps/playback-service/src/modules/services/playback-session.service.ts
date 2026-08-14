import { randomUUID } from "node:crypto";
import { redis, sessionKey } from "@/redis/client";
import type {
  PlaybackSessionRecord,
  PlaybackStatus,
} from "@/modules/schema/playback.schema";

const SESSION_TTL_SECONDS = 60 * 60 * 6; // 6h, sessions are meant to be short-lived

export async function createSessionRecord(params: {
  airportId: string;
  from: Date;
  to: Date;
  speed: number;
}): Promise<PlaybackSessionRecord> {
  const record: PlaybackSessionRecord = {
    id: randomUUID(),
    airportId: params.airportId,
    from: params.from.toISOString(),
    to: params.to.toISOString(),
    speed: params.speed,
    status: "created",
    cursor: params.from.getTime(),
    createdAt: new Date().toISOString(),
  };

  await saveSessionRecord(record);
  return record;
}

export async function saveSessionRecord(
  record: PlaybackSessionRecord,
): Promise<void> {
  await redis.hset(sessionKey(record.id), {
    id: record.id,
    airportId: record.airportId,
    from: record.from,
    to: record.to,
    speed: String(record.speed),
    status: record.status,
    cursor: String(record.cursor),
    createdAt: record.createdAt,
  });
  await redis.expire(sessionKey(record.id), SESSION_TTL_SECONDS);
}

export async function getSessionRecord(
  sessionId: string,
): Promise<PlaybackSessionRecord | null> {
  const raw = await redis.hgetall(sessionKey(sessionId));
  if (!raw || Object.keys(raw).length === 0) return null;

  return {
    id: raw.id,
    airportId: raw.airportId,
    from: raw.from,
    to: raw.to,
    speed: Number(raw.speed),
    status: raw.status as PlaybackStatus,
    cursor: Number(raw.cursor),
    createdAt: raw.createdAt,
  };
}

export async function deleteSessionRecord(sessionId: string): Promise<void> {
  await redis.del(sessionKey(sessionId));
}
