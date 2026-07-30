import { logger } from "@repo/logger";
import cron, { type ScheduledTask } from "node-cron";
import { env } from "@/config/env";
import { parseMetar } from "../parser/metar.parser";
import { parseTaf } from "../parser/taf.parser";
import { fetchLatestMetar } from "../provider/metar.provider";
import { fetchLatestTaf } from "../provider/taf.provider";
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
let tafTask: ScheduledTask | null = null;

export const pollMetar = async (): Promise<void> => {
  const station = env.WEATHER_STATION_ICAO;
  const startedAt = Date.now();
  logger.info({ station }, "metar polling started");

  try {
    const item = await fetchLatestMetar(station);
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
      kind: item.metarType,
      observedAt: new Date(item.obsTime * 1000),
      raw: item.rawOb,
      parsed,
      providerRaw: { ...item },
      source: "aviationweather",
    });

    logger.info(
      {
        station: item.icaoId,
        durationMs: Date.now() - startedAt,
        result: "saved",
      },
      "metar polling finished",
    );
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

export const pollTaf = async (): Promise<void> => {
  const station = env.WEATHER_STATION_ICAO;
  const startedAt = Date.now();
  logger.info({ station }, "taf polling started");

  try {
    const item = await fetchLatestTaf(station);
    if (!item) {
      logger.info(
        { station, durationMs: Date.now() - startedAt, result: "no-data" },
        "taf polling finished",
      );
      return;
    }

    const parsed = parseTaf(item.rawTAF, item.fcsts);

    await saveForecast({
      station: item.icaoId,
      issuedAt: new Date(item.issueTime),
      validFrom: new Date(item.validTimeFrom * 1000),
      validTo: new Date(item.validTimeTo * 1000),
      raw: item.rawTAF,
      parsed,
      providerRaw: { ...item },
      source: "aviationweather",
    });

    logger.info(
      {
        station: item.icaoId,
        durationMs: Date.now() - startedAt,
        result: "saved",
      },
      "taf polling finished",
    );
  } catch (err) {
    logger.error(
      { err, station, durationMs: Date.now() - startedAt },
      "taf polling cycle failed",
    );
    throw err;
  }
};

export const startWeatherPolling = (): void => {
  const metarCron = intervalMsToCronExpression(env.METAR_POLL_INTERVAL_MS);
  const tafCron = intervalMsToCronExpression(env.TAF_POLL_INTERVAL_MS);

  metarTask = cron.schedule(metarCron, pollMetar, {
    name: "metar-poll",
    noOverlap: true, // node-cron itself skips a tick if the previous run hasn't finished yet
  });

  tafTask = cron.schedule(tafCron, pollTaf, {
    name: "taf-poll",
    noOverlap: true,
  });

  // v4 tasks start automatically once scheduled — fire an out-of-schedule
  // run immediately so we don't wait for the first wall-clock tick.
  void metarTask.execute();
  void tafTask.execute();

  logger.info(
    {
      metarIntervalMs: env.METAR_POLL_INTERVAL_MS,
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
  if (tafTask) {
    void tafTask.destroy();
    tafTask = null;
  }
};
