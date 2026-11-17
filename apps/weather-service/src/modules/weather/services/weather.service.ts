import {
  db,
  type MetarParsedData,
  type TafParsedData,
  weatherForecasts,
  weatherObservations,
  weatherSyncMetadata,
} from "@repo/database";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
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

export interface TafHistoryItem {
  station: string;
  kind: "TAF";
  observedAt: string; // = issuedAt for consistent sorting
  issuedAt: string;
  validFrom: string;
  validTo: string;
  raw: string;
  forecast: TafParsedData;
  stale: boolean;
  sync: WeatherSyncMetadataResult;
}

export type WeatherHistoryItem = CurrentObservationResult | TafHistoryItem;

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

export type ObservationKind = "METAR" | "SPECI" | "TAF";
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

// ponytail: one shared where-builder so history query and count stay consistent
function observationHistoryWhere(
  params: GetObservationHistoryParams,
): ReturnType<typeof and> {
  const resolvedStation = params.station ?? env.WEATHER_STATION_ICAO;
  return and(
    eq(weatherObservations.station, resolvedStation),
    params.kind ? eq(weatherObservations.kind, params.kind) : undefined,
    params.from ? gte(weatherObservations.observedAt, params.from) : undefined,
    params.to ? lte(weatherObservations.observedAt, params.to) : undefined,
  );
}

function forecastHistoryWhere(
  params: GetObservationHistoryParams,
): ReturnType<typeof and> {
  const resolvedStation = params.station ?? env.WEATHER_STATION_ICAO;
  return and(
    eq(weatherForecasts.station, resolvedStation),
    params.from ? gte(weatherForecasts.issuedAt, params.from) : undefined,
    params.to ? lte(weatherForecasts.issuedAt, params.to) : undefined,
  );
}

export async function getObservationHistory(
  params: GetObservationHistoryParams,
): Promise<WeatherHistoryItem[]> {
  const resolvedStation = params.station ?? env.WEATHER_STATION_ICAO;
  const sync = await getWeatherSyncMetadata(resolvedStation);

  // kind = TAF → query forecasts only
  if (params.kind === "TAF") {
    const forecasts = await db.query.weatherForecasts.findMany({
      where: forecastHistoryWhere(params),
      orderBy: desc(weatherForecasts.issuedAt),
      limit: params.size,
      offset: (params.page - 1) * params.size,
    });

    return forecasts.map((forecast) => {
      const stale = isForecastStale(forecast.validTo);
      return {
        station: forecast.station,
        kind: "TAF",
        observedAt: forecast.issuedAt.toISOString(),
        issuedAt: forecast.issuedAt.toISOString(),
        validFrom: forecast.validFrom.toISOString(),
        validTo: forecast.validTo.toISOString(),
        raw: forecast.raw,
        forecast: forecast.parsed,
        stale,
        sync,
      };
    });
  }

  // kind = METAR/SPECI → query observations only
  if (params.kind === "METAR" || params.kind === "SPECI") {
    const observations = await db.query.weatherObservations.findMany({
      where: observationHistoryWhere(params),
      orderBy: desc(weatherObservations.observedAt),
      limit: params.size,
      offset: (params.page - 1) * params.size,
    });

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

  // kind kosong → UNION ALL observations + forecasts, diurutkan observedAt desc
  // Untuk type-safety, fetch masing-masing lalu merge & sort di server-side
  const obsObservations = await db.query.weatherObservations.findMany({
    where: observationHistoryWhere(params),
    orderBy: desc(weatherObservations.observedAt),
  });

  const tafForecasts = await db.query.weatherForecasts.findMany({
    where: forecastHistoryWhere(params),
    orderBy: desc(weatherForecasts.issuedAt),
  });

  // Map observations to WeatherHistoryItem
  const obsItems: WeatherHistoryItem[] = obsObservations.map((observation) => {
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

  // Map forecasts to WeatherHistoryItem
  const tafItems: WeatherHistoryItem[] = tafForecasts.map((forecast) => {
    const stale = isForecastStale(forecast.validTo);
    return {
      station: forecast.station,
      kind: "TAF",
      observedAt: forecast.issuedAt.toISOString(),
      issuedAt: forecast.issuedAt.toISOString(),
      validFrom: forecast.validFrom.toISOString(),
      validTo: forecast.validTo.toISOString(),
      raw: forecast.raw,
      forecast: forecast.parsed,
      stale,
      sync,
    };
  });

  // Merge & sort by observedAt desc, then apply pagination
  const combined = [...obsItems, ...tafItems].sort(
    (a, b) =>
      new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime(),
  );
  const offset = (params.page - 1) * params.size;
  const paginated = combined.slice(offset, offset + params.size);

  return paginated;
}

export async function getObservationHistoryCount(
  params: GetObservationHistoryParams,
): Promise<number> {
  // kind = TAF → count forecasts
  if (params.kind === "TAF") {
    return await db.$count(weatherForecasts, forecastHistoryWhere(params));
  }

  // kind = METAR/SPECI → count observations
  if (params.kind === "METAR" || params.kind === "SPECI") {
    return await db.$count(
      weatherObservations,
      observationHistoryWhere(params),
    );
  }

  // kind kosong → count observations + forecasts
  const observationCount = await db.$count(
    weatherObservations,
    observationHistoryWhere(params),
  );
  const forecastCount = await db.$count(
    weatherForecasts,
    forecastHistoryWhere(params),
  );
  return observationCount + forecastCount;
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
