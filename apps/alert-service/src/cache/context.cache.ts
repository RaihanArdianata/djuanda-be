import type { AftnMessage } from "@repo/database";
import { redis } from "@/redis/client";
import type {
  AerodromeContextData,
  WeatherContextData,
} from "../modules/engine/types";

const weatherKey = (airportId: string): string => `weather:${airportId}`;
const aerodromeKey = (airportId: string): string =>
  `aerodrome:${airportId}:geometry`;
const aftnKey = (airportId: string, id: string): string =>
  `advisory:aftn:${airportId}:${id}`;

// weather

export async function getWeather(
  airportId: string,
): Promise<WeatherContextData | null> {
  const value = await redis.get(weatherKey(airportId));
  if (!value) return null;
  try {
    return JSON.parse(value) as WeatherContextData;
  } catch {
    return null;
  }
}

export async function setWeather(
  airportId: string,
  value: WeatherContextData,
  ttlSeconds = 600,
): Promise<void> {
  await redis.set(
    weatherKey(airportId),
    JSON.stringify(value),
    "EX",
    ttlSeconds,
  );
}

// aerodrome

export async function getAerodromeGeometry(
  airportId: string,
): Promise<AerodromeContextData | null> {
  const value = await redis.get(aerodromeKey(airportId));
  if (!value) return null;
  try {
    return JSON.parse(value) as AerodromeContextData;
  } catch {
    return null;
  }
}

export async function setAerodromeGeometry(
  airportId: string,
  value: AerodromeContextData,
  ttlSeconds = 86400,
): Promise<void> {
  await redis.set(
    aerodromeKey(airportId),
    JSON.stringify(value),
    "EX",
    ttlSeconds,
  );
}

export async function deleteAerodromeGeometry(
  airportId: string,
): Promise<void> {
  await redis.del(aerodromeKey(airportId));
}

// advisory (AFTN)

async function scanAftnKeys(airportId: string): Promise<string[]> {
  const pattern = `advisory:aftn:${airportId}:*`;
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
  return keys;
}

export async function getAftnMessages(
  airportId: string,
): Promise<AftnMessage[]> {
  const keys = await scanAftnKeys(airportId);
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  const messages: AftnMessage[] = [];
  for (const v of values) {
    if (!v) continue;
    try {
      messages.push(JSON.parse(v) as AftnMessage);
    } catch {
      // skip invalid entries
    }
  }
  return messages;
}

export async function setAftnMessage(
  airportId: string,
  id: string,
  message: AftnMessage,
  ttlSeconds = 3600,
): Promise<void> {
  await redis.set(
    aftnKey(airportId, id),
    JSON.stringify(message),
    "EX",
    ttlSeconds,
  );
}
