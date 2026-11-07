import {
  db,
  type MetarParsedData,
  type TafParsedData,
  weatherForecasts,
  weatherObservations,
  weatherSyncMetadata,
} from "@repo/database";
import { and, desc, eq } from "drizzle-orm";
import { env } from "@/config/env";
import { isForecastStale, isObservationStale } from "../lib/staleness";
import type { GetObservationHistoryParams } from "../validator/weather.validator";

export interface CurrentObservationResult {
  station: string;
  kind: string;
  observedAt: string;
  raw: string;
  parsed: MetarParsedData;
  stale: boolean;
  staleSince: string | null;
  sync: WeatherSyncMetadataResult;
}

export interface ForecastResult {
  station: string;
  issuedAt: string;
  validFrom: string;
  validTo: string;
  raw: string;
  forecast: TafParsedData;
  stale: boolean;
  sync: WeatherSyncMetadataResult;
}

export type ObservationKind = "METAR" | "SPECI";
export type WeatherSyncStatus = "NEVER" | "SYNCING" | "SUCCESS" | "FAILED";

export interface WeatherSyncMetadataResult {
  lastSuccessfulSyncAt: string | null;
  lastSyncStatus: WeatherSyncStatus;
  lastAttemptAt: string | null;
  lastSyncError: string | null;
}

const emptySyncMetadata: WeatherSyncMetadataResult = {
  lastSuccessfulSyncAt: null,
  lastSyncStatus: "NEVER",
  lastAttemptAt: null,
  lastSyncError: null,
};

const safeSyncError = (error: unknown): string => {
  const message =
    error instanceof Error ? error.message : "Weather sync failed";
  return message.replace(/\s+/g, " ").slice(0, 200);
};

export async function getWeatherSyncMetadata(
  station: string = env.WEATHER_STATION_ICAO,
): Promise<WeatherSyncMetadataResult> {
  const row = await db.query.weatherSyncMetadata.findFirst({
    where: eq(weatherSyncMetadata.station, station),
  });
  return row
    ? {
        lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
        lastSyncStatus: row.lastSyncStatus as WeatherSyncStatus,
        lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
        lastSyncError: row.lastSyncError,
      }
    : emptySyncMetadata;
}

export async function setWeatherSyncStarted(
  station: string = env.WEATHER_STATION_ICAO,
  at: Date = new Date(),
): Promise<void> {
  await db
    .insert(weatherSyncMetadata)
    .values({
      station,
      lastSyncStatus: "SYNCING",
      lastAttemptAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: weatherSyncMetadata.station,
      set: { lastSyncStatus: "SYNCING", lastAttemptAt: at, updatedAt: at },
    });
}

export async function setWeatherSyncSucceeded(
  station: string = env.WEATHER_STATION_ICAO,
  at: Date = new Date(),
): Promise<void> {
  await db
    .insert(weatherSyncMetadata)
    .values({
      station,
      lastSuccessfulSyncAt: at,
      lastSyncStatus: "SUCCESS",
      lastAttemptAt: at,
      lastSyncError: null,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: weatherSyncMetadata.station,
      set: {
        lastSuccessfulSyncAt: at,
        lastSyncStatus: "SUCCESS",
        lastAttemptAt: at,
        lastSyncError: null,
        updatedAt: at,
      },
    });
}

export async function setWeatherSyncFailed(
  error: unknown,
  station: string = env.WEATHER_STATION_ICAO,
  at: Date = new Date(),
): Promise<void> {
  const message = safeSyncError(error);
  await db
    .insert(weatherSyncMetadata)
    .values({
      station,
      lastSyncStatus: "FAILED",
      lastAttemptAt: at,
      lastSyncError: message,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: weatherSyncMetadata.station,
      set: {
        lastSyncStatus: "FAILED",
        lastAttemptAt: at,
        lastSyncError: message,
        updatedAt: at,
      },
    });
}

interface SaveObservationParams {
  station: string;
  kind: string;
  observedAt: Date;
  raw: string;
  parsed: MetarParsedData;
  providerRaw: Record<string, unknown>;
  source: string;
}

interface SaveForecastParams {
  station: string;
  issuedAt: Date;
  validFrom: Date;
  validTo: Date;
  raw: string;
  parsed: TafParsedData;
  providerRaw: Record<string, unknown>;
  source: string;
}

export async function saveObservation(
  params: SaveObservationParams,
): Promise<boolean> {
  const existing = await db.query.weatherObservations.findFirst({
    where: and(
      eq(weatherObservations.station, params.station),
      eq(weatherObservations.kind, params.kind),
      eq(weatherObservations.observedAt, params.observedAt),
      eq(weatherObservations.source, params.source),
    ),
  });
  if (existing) return false;

  await db.insert(weatherObservations).values(params);
  return true;
}

export async function saveForecast(
  params: SaveForecastParams,
): Promise<boolean> {
  const existing = await db.query.weatherForecasts.findFirst({
    where: and(
      eq(weatherForecasts.station, params.station),
      eq(weatherForecasts.issuedAt, params.issuedAt),
      eq(weatherForecasts.source, params.source),
    ),
  });
  if (existing) return false;

  await db.insert(weatherForecasts).values(params);
  return true;
}

export async function getCurrentObservation(
  station: string | undefined,
): Promise<CurrentObservationResult | null> {
  return getLatestObservation(station, undefined);
}

export async function getLatestObservation(
  station: string | undefined,
  kind: ObservationKind | undefined,
): Promise<CurrentObservationResult | null> {
  const resolvedStation = station ?? env.WEATHER_STATION_ICAO;

  const observation = await db.query.weatherObservations.findFirst({
    where: kind
      ? and(
          eq(weatherObservations.station, resolvedStation),
          eq(weatherObservations.kind, kind),
        )
      : eq(weatherObservations.station, resolvedStation),
    orderBy: desc(weatherObservations.observedAt),
  });

  if (!observation) {
    return null;
  }

  const stale = isObservationStale(observation.observedAt);
  const sync = await getWeatherSyncMetadata(resolvedStation);

  return {
    station: observation.station,
    kind: observation.kind,
    observedAt: observation.observedAt.toISOString(),
    raw: observation.raw,
    parsed: observation.parsed,
    stale,
    staleSince: stale ? observation.observedAt.toISOString() : null,
    sync,
  };
}

export async function getObservationHistory(
  params: GetObservationHistoryParams,
): Promise<CurrentObservationResult[]> {
  const resolvedStation = params.station ?? env.WEATHER_STATION_ICAO;

  const whereClause = params.kind
    ? and(
        eq(weatherObservations.station, resolvedStation),
        eq(weatherObservations.kind, params.kind),
      )
    : eq(weatherObservations.station, resolvedStation);

  const observations = await db.query.weatherObservations.findMany({
    where: whereClause,
    orderBy: desc(weatherObservations.observedAt),
    limit: params.size,
    offset: (params.page - 1) * params.size,
  });
  const sync = await getWeatherSyncMetadata(resolvedStation);

  return observations.map((observation) => {
    const stale = isObservationStale(observation.observedAt);
    return {
      station: observation.station,
      kind: observation.kind,
      observedAt: observation.observedAt.toISOString(),
      raw: observation.raw,
      parsed: observation.parsed,
      stale,
      staleSince: stale ? observation.observedAt.toISOString() : null,
      sync,
    };
  });
}

export async function getObservationHistoryCount(
  params: GetObservationHistoryParams,
): Promise<number> {
  const resolvedStation = params.station ?? env.WEATHER_STATION_ICAO;

  const whereClause = params.kind
    ? and(
        eq(weatherObservations.station, resolvedStation),
        eq(weatherObservations.kind, params.kind),
      )
    : eq(weatherObservations.station, resolvedStation);

  return await db.$count(weatherObservations, whereClause);
}

export async function getActiveForecast(
  station: string | undefined,
): Promise<ForecastResult | null> {
  const resolvedStation = station ?? env.WEATHER_STATION_ICAO;

  const forecast = await db.query.weatherForecasts.findFirst({
    where: eq(weatherForecasts.station, resolvedStation),
    orderBy: desc(weatherForecasts.issuedAt),
  });

  if (!forecast) {
    return null;
  }

  return {
    station: forecast.station,
    issuedAt: forecast.issuedAt.toISOString(),
    validFrom: forecast.validFrom.toISOString(),
    validTo: forecast.validTo.toISOString(),
    raw: forecast.raw,
    forecast: forecast.parsed,
    stale: isForecastStale(forecast.validTo),
    sync: await getWeatherSyncMetadata(resolvedStation),
  };
}
