import { logger } from "@repo/logger";
import { redis } from "../redis/client";

export function activeAlertKey(
  airportId: string,
  type: string,
  entityKey: string,
): string {
  return `alert:active:${airportId}:${type}:${entityKey}`;
}

export async function setActiveAlert(
  airportId: string,
  type: string,
  entityKey: string,
  alertId: string,
  ttlSeconds = 300,
): Promise<void> {
  try {
    await redis.setex(
      activeAlertKey(airportId, type, entityKey),
      ttlSeconds,
      alertId,
    );
  } catch (err) {
    logger.warn({ err, airportId, type, entityKey }, "setActiveAlert failed");
  }
}

export async function getActiveAlert(
  airportId: string,
  type: string,
  entityKey: string,
): Promise<string | null> {
  try {
    return (
      (await redis.get(activeAlertKey(airportId, type, entityKey))) ?? null
    );
  } catch (err) {
    logger.warn({ err, airportId, type, entityKey }, "getActiveAlert failed");
    return null;
  }
}

export async function clearActiveAlert(
  airportId: string,
  type: string,
  entityKey: string,
): Promise<void> {
  try {
    await redis.del(activeAlertKey(airportId, type, entityKey));
  } catch (err) {
    logger.warn({ err, airportId, type, entityKey }, "clearActiveAlert failed");
  }
}

export interface ActiveAlertRef {
  key: string;
  type: string;
  entityKey: string;
  alertId: string | null;
}

export async function getActiveAlertRefs(
  airportId: string,
): Promise<ActiveAlertRef[]> {
  try {
    const pattern = `alert:active:${airportId}:*`;
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
    return keys.map((key, i) => {
      const parts = key.split(":");
      const type = parts[3] ?? "";
      const entityKey = parts.slice(4).join(":");
      return {
        key,
        type,
        entityKey,
        alertId: (values[i] as string | null) ?? null,
      };
    });
  } catch (err) {
    logger.warn({ err, airportId }, "getActiveAlertRefs failed");
    return [];
  }
}
