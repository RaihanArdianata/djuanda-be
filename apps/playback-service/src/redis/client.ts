import { redisConfig } from "@repo/config";
import { Redis } from "ioredis";

// Plain client for GET/SET/HSET etc.
export const redis = new Redis(redisConfig);

// ioredis puts a connection in subscriber mode once you SUBSCRIBE, so
// publishing and subscribing need separate connections.
export const redisSub = new Redis(redisConfig);

export function sessionKey(sessionId: string): string {
  return `playback:session:${sessionId}`;
}

export function streamChannel(sessionId: string): string {
  return `playback:stream:${sessionId}`;
}
