import {
  db,
  type MetarParsedData,
  type TafParsedData,
  weatherForecasts,
  weatherObservations,
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
}

export interface ForecastResult {
  station: string;
  issuedAt: string;
  validFrom: string;
  validTo: string;
  raw: string;
  forecast: TafParsedData;
  stale: boolean;
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
): Promise<void> {
  await db.insert(weatherObservations).values(params);
}

export async function saveForecast(
  params: SaveForecastParams,
): Promise<void> {
  await db.insert(weatherForecasts).values(params);
}

export async function getCurrentObservation(
  station: string | undefined,
): Promise<CurrentObservationResult | null> {
  const resolvedStation = station ?? env.WEATHER_STATION_ICAO;

  const observation = await db.query.weatherObservations.findFirst({
    where: eq(weatherObservations.station, resolvedStation),
    orderBy: desc(weatherObservations.observedAt),
  });

  if (!observation) {
    return null;
  }

  const stale = isObservationStale(observation.observedAt);

  return {
    station: observation.station,
    kind: observation.kind,
    observedAt: observation.observedAt.toISOString(),
    raw: observation.raw,
    parsed: observation.parsed,
    stale,
    staleSince: stale ? observation.observedAt.toISOString() : null,
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
  };
}