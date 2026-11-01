import { logger } from "@repo/logger";
import { publishToTopic } from "@repo/shared/sse/publisher";
import cron, { type ScheduledTask } from "node-cron";
import { env } from "@/config/env";
import { publishWeatherEvent } from "../../messaging/weather.producer";
import { isForecastStale, isObservationStale } from "../lib/staleness";
import { parseMetar } from "../parser/metar.parser";
import { parseTaf } from "../parser/taf.parser";
import {
  fetchLatestBmkgMetar,
  fetchLatestBmkgSpeci,
  fetchLatestBmkgTaf,
} from "../provider/bmkg.provider";
import { saveForecast, saveObservation } from "./weather.service";

// Converts an interval in ms into a wall-clock cron expression, e.g.
// 1_800_000 (30 min) -> "*/30 * * * *", 3_600_000 (60 min) -> "0 * * * *".
// Only supports intervals that are a whole-minute divisor of 60, since a
// standard cron expression can't express "every 45 minutes" cleanly.
const intervalMsToCronExpression = (intervalMs: number): string => {
  if (intervalMs <= 0 || intervalMs % 60_000 !== 0) {
    throw new Error(
      `Poll interval must be a whole number of minutes, got ${intervalMs}ms`,
    );
  }

  const minutes = intervalMs / 60_000;

  if (minutes >= 60) {
    if (minutes % 60 !== 0) {
      throw new Error(
        `Poll interval over an hour must be a multiple of 60 minutes, got ${minutes}m`,
      );
    }
    return `0 */${minutes / 60} * * *`;
  }

  if (60 % minutes !== 0) {
    throw new Error(
      `Poll interval must evenly divide 60 minutes for a cron schedule, got ${minutes}m`,
    );
  }

  return `*/${minutes} * * * *`;
};

let metarTask: ScheduledTask | null = null;
let speciTask: ScheduledTask | null = null;
let tafTask: ScheduledTask | null = null;

export const pollMetar = async (): Promise<void> => {
  const station = env.WEATHER_STATION_ICAO;
  const startedAt = Date.now();
  logger.info({ station }, "metar polling started");

  try {
    const item = await fetchLatestBmkgMetar();
    if (!item) {
      logger.info(
        { station, durationMs: Date.now() - startedAt, result: "no-data" },
        "metar polling finished",
      );
      return;
    }

    const parsed = parseMetar(item.rawOb);

    await saveObservation({
      station: item.icaoId,
      kind: "METAR",
      observedAt: new Date(item.obsTime),
      raw: item.rawOb,
      parsed,
      providerRaw: { ...item.providerRaw, reportId: item.reportId },
      source: "bmkg",
    });

    await publishWeatherEvent(item.icaoId, item.icaoId, parsed, null);

    logger.info(
      {
        station: item.icaoId,
        durationMs: Date.now() - startedAt,
        result: "saved",
      },
      "metar polling finished",
    );

    await publishToTopic("weather.updated", {
      station: item.icaoId,
      kind: "METAR",
      observedAt: new Date(item.obsTime).toISOString(),
      stale: isObservationStale(new Date(item.obsTime)),
    });
  } catch (err) {
    logger.error(
      { err, station, durationMs: Date.now() - startedAt },
      "metar polling cycle failed",
    );
    // Re-throw so node-cron records this as a failed run in lastRun()
    // instead of silently reporting it as a successful execution.
    throw err;
  }
};

export const pollSpeci = async (): Promise<void> => {
  const station = env.WEATHER_STATION_ICAO;
  const startedAt = Date.now();
  logger.info({ station }, "speci polling started");
  try {
    const item = await fetchLatestBmkgSpeci();
    if (!item) return;
    const parsed = parseMetar(item.rawOb);
    await saveObservation({
      station: item.icaoId,
      kind: "SPECI",
      observedAt: new Date(item.obsTime),
      raw: item.rawOb,
      parsed,
      providerRaw: { ...item.providerRaw, reportId: item.reportId },
      source: "bmkg",
    });
    await publishWeatherEvent(item.icaoId, item.icaoId, parsed, null);
    await publishToTopic("weather.updated", {
      station: item.icaoId,
      kind: "SPECI",
      observedAt: new Date(item.obsTime).toISOString(),
      stale: isObservationStale(new Date(item.obsTime)),
    });
    logger.info(
      { station, durationMs: Date.now() - startedAt, result: "saved" },
      "speci polling finished",
    );
  } catch (err) {
    logger.error(
      { err, station, durationMs: Date.now() - startedAt },
      "speci polling cycle failed",
    );
    throw err;
  }
};

export const pollTaf = async (): Promise<void> => {
  const station = env.WEATHER_STATION_ICAO;
  const startedAt = Date.now();
  logger.info({ station }, "taf polling started");

  try {
    const item = await fetchLatestBmkgTaf();
    if (!item) {
      logger.info(
        { station, durationMs: Date.now() - startedAt, result: "no-data" },
        "taf polling finished",
      );
      return;
    }

    const parsed = parseTaf(item.rawTaf, [
      { timeFrom: item.validTimeFrom / 1000, timeTo: item.validTimeTo / 1000 },
    ]);

    await saveForecast({
      station: item.icaoId,
      issuedAt: new Date(item.issueTime),
      validFrom: new Date(item.validTimeFrom),
      validTo: new Date(item.validTimeTo),
      raw: item.rawTaf,
      parsed,
      providerRaw: { ...item.providerRaw, reportId: item.reportId },
      source: "bmkg",
    });

    await publishWeatherEvent(item.icaoId, item.icaoId, null, parsed);

    logger.info(
      {
        station: item.icaoId,
        durationMs: Date.now() - startedAt,
        result: "saved",
      },
      "taf polling finished",
    );

    await publishToTopic("weather.forecast.updated", {
      station: item.icaoId,
      validFrom: new Date(item.validTimeFrom).toISOString(),
      validTo: new Date(item.validTimeTo).toISOString(),
      stale: isForecastStale(new Date(item.validTimeTo)),
    });
  } catch (err) {
    logger.error(
      { err, station, durationMs: Date.now() - startedAt },
      "taf polling cycle failed",
    );
    throw err;
  }
};

const SYNC_COOLDOWN_MS = 30_000;
let lastManualSyncAt = 0;

export interface ManualSyncResult {
  /** Detik tersisa sebelum sync manual berikutnya boleh jalan; 0 bila baru saja jalan. */
  retryAfterSec: number;
  results: Record<"metar" | "speci" | "taf", "ok" | "failed">;
}

/**
 * Tarik METAR, SPECI, dan TAF dari BMKG sekarang juga (tombol resync di FE).
 * Dibatasi satu kali per SYNC_COOLDOWN_MS supaya tidak menghujani BMKG.
 * Return `null` bila masih dalam masa tunggu.
 */
export const syncWeatherNow = async (
  now: number = Date.now(),
): Promise<ManualSyncResult | null> => {
  if (now - lastManualSyncAt < SYNC_COOLDOWN_MS) return null;
  lastManualSyncAt = now;

  const [metar, speci, taf] = await Promise.allSettled([
    pollMetar(),
    pollSpeci(),
    pollTaf(),
  ]);
  const status = (r: PromiseSettledResult<void>): "ok" | "failed" =>
    r.status === "fulfilled" ? "ok" : "failed";

  return {
    retryAfterSec: SYNC_COOLDOWN_MS / 1000,
    results: { metar: status(metar), speci: status(speci), taf: status(taf) },
  };
};

export const startWeatherPolling = (): void => {
  const metarCron = intervalMsToCronExpression(env.METAR_POLL_INTERVAL_MS);
  const speciCron = intervalMsToCronExpression(env.SPECI_POLL_INTERVAL_MS);
  const tafCron = intervalMsToCronExpression(env.TAF_POLL_INTERVAL_MS);

  metarTask = cron.schedule(metarCron, pollMetar, {
    name: "metar-poll",
    noOverlap: true, // node-cron itself skips a tick if the previous run hasn't finished yet
  });
  speciTask = cron.schedule(speciCron, pollSpeci, {
    name: "speci-poll",
    noOverlap: true,
  });

  tafTask = cron.schedule(tafCron, pollTaf, {
    name: "taf-poll",
    noOverlap: true,
  });

  // v4 tasks start automatically once scheduled — fire an out-of-schedule
  // run immediately so we don't wait for the first wall-clock tick.
  void metarTask.execute();
  void speciTask.execute();
  void tafTask.execute();

  logger.info(
    {
      metarIntervalMs: env.METAR_POLL_INTERVAL_MS,
      speciIntervalMs: env.SPECI_POLL_INTERVAL_MS,
      tafIntervalMs: env.TAF_POLL_INTERVAL_MS,
      metarCron,
      tafCron,
    },
    "weather polling started",
  );
};

export const stopWeatherPolling = (): void => {
  if (metarTask) {
    void metarTask.destroy();
    metarTask = null;
  }
  if (speciTask) {
    void speciTask.destroy();
    speciTask = null;
  }
  if (tafTask) {
    void tafTask.destroy();
    tafTask = null;
  }
};
