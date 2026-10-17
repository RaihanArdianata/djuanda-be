import { logger } from "@repo/logger";
import { redis } from "../redis/client";

export function activeAlertKey(
  airportId: string,
  type: string,
  entityKey: string,
): string {
  return `alert:active:${airportId}:${type}:${entityKey}`;
}

/** TTL key active-alert — sama untuk claim & refresh. Dipakai engine untuk
 *  menghitung berapa lama sebuah ref tidak di-refresh (grace period clear). */
export const ACTIVE_ALERT_TTL_SECONDS = 300;

/**
 * Klaim entity secara atomic (SET ... NX) sebelum membuat alert baru.
 * Mencegah race condition: dua track update yang datang berdekatan untuk
 * entity yang sama bisa lolos berdua kalau pengecekan "apa sudah ada alert
 * aktif" dan penulisan "sekarang ada alert aktif" dilakukan terpisah
 * (check-then-act) dengan proses DB insert yang lama di antaranya.
 * Return true kalau klaim berhasil (pemanggil ini yang berhak lanjut buat
 * alert baru), false kalau entity sudah diklaim pemanggil lain.
 */
export async function claimActiveAlert(
  airportId: string,
  type: string,
  entityKey: string,
  placeholder: string,
  ttlSeconds = ACTIVE_ALERT_TTL_SECONDS,
): Promise<boolean> {
  try {
    const result = await redis.set(
      activeAlertKey(airportId, type, entityKey),
      placeholder,
      "EX",
      ttlSeconds,
      "NX",
    );
    return result === "OK";
  } catch (err) {
    logger.warn({ err, airportId, type, entityKey }, "claimActiveAlert failed");
    return false;
  }
}

export async function setActiveAlert(
  airportId: string,
  type: string,
  entityKey: string,
  alertId: string,
  ttlSeconds = ACTIVE_ALERT_TTL_SECONDS,
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

/**
 * Sisa TTL (detik) sebuah key active-alert — dipakai clearStaleAlerts untuk
 * menghitung berapa lama candidate-nya tidak terlihat. -2 = key sudah tidak
 * ada (expired/dihapus), -1 = tidak ada expiry.
 */
export async function getActiveAlertTtl(key: string): Promise<number> {
  try {
    return await redis.ttl(key);
  } catch (err) {
    logger.warn({ err, key }, "getActiveAlertTtl failed");
    return -2;
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
