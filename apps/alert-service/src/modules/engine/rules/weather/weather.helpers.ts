import {
  type Conditions,
  forecastAt,
  type Metar,
  parseMetar,
  parseTaf,
  type Taf,
} from "@aeroswarm/weather";
import type { AlertCandidate, AlertContext } from "../../types";

/** Laporan yang lebih tua dari ini tidak dipakai (alert dari laporan basi menyesatkan). */
export const DEFAULT_MAX_OBSERVATION_AGE_MINUTES = 120;
/** Seberapa jauh ke depan TAF diperiksa untuk peringatan dini. */
export const DEFAULT_FORECAST_HOURS = 3;

const STEP_MS = 30 * 60_000;

export interface WeatherReading {
  station: string;
  /** Pengamatan terbaru yang masih segar; null bila tidak ada atau sudah basi. */
  observation: Metar | null;
  /** TAF yang terbaca; null bila tidak ada atau dibatalkan. */
  forecast: Taf | null;
}

export interface ForecastSample {
  at: Date;
  conditions: Conditions;
}

/** Angka positif dari konfigurasi rule, atau undefined. */
export function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

/** Pengamatan yang masih segar: METAR dari teks mentah, tidak basi, dan umurnya masih dalam batas. */
function readObservation(
  ctx: AlertContext,
  config: Record<string, unknown>,
): Metar | null {
  const current = ctx.weather?.current;
  if (!current?.raw || current.stale) return null;
  const maxAgeMs =
    (positive(config.maxObservationAgeMinutes) ??
      DEFAULT_MAX_OBSERVATION_AGE_MINUTES) * 60_000;
  const observedAt = new Date(current.observedAt);
  const parsed = parseMetar(
    current.raw,
    Number.isNaN(observedAt.getTime()) ? ctx.timestamp : observedAt,
  );
  if (!parsed) return null;
  const age = ctx.timestamp.getTime() - parsed.observedAt.getTime();
  return age <= maxAgeMs && age >= -5 * 60_000 ? parsed : null;
}

/** TAF dari teks mentah; null bila tidak ada, basi, tidak terbaca, atau dibatalkan. */
function readForecast(ctx: AlertContext): Taf | null {
  const forecast = ctx.weather?.forecast;
  if (!forecast?.raw || forecast.stale) return null;
  const parsed = parseTaf(forecast.raw, ctx.timestamp);
  return parsed && !parsed.cancelled ? parsed : null;
}

/**
 * Baca konteks cuaca: dekode teks mentah METAR dan TAF dengan `@aeroswarm/weather`. Pengamatan yang
 * lebih tua dari `maxObservationAgeMinutes` (atau ditandai basi oleh weather-service) diabaikan, jadi
 * tidak ada alert dari data lama.
 */
export function readWeather(
  ctx: AlertContext,
  config: Record<string, unknown>,
): WeatherReading | null {
  if (!ctx.weather) return null;
  return {
    station: ctx.weather.station,
    observation: readObservation(ctx, config),
    forecast: readForecast(ctx),
  };
}

/** Kondisi TAF tiap 30 menit dari sekarang sampai `hours` jam ke depan (hanya yang berlaku). */
export function forecastSamples(
  taf: Taf,
  from: Date,
  hours: number,
): ForecastSample[] {
  const samples: ForecastSample[] = [];
  const end = from.getTime() + hours * 3_600_000;
  for (let t = from.getTime(); t <= end; t += STEP_MS) {
    const at = new Date(t);
    const state = forecastAt(taf, at);
    if (state) samples.push({ at, conditions: state.conditions });
  }
  return samples;
}

export function forecastHoursOf(config: Record<string, unknown>): number {
  const hours = config.forecastHours;
  return typeof hours === "number" && Number.isFinite(hours) && hours >= 0
    ? hours
    : DEFAULT_FORECAST_HOURS;
}

/** Titik tengah bandara dari polygon runway (untuk marker alert); null bila tidak ada data aerodrome. */
export function airportPosition(
  ctx: AlertContext,
): { latitude: number; longitude: number } | null {
  const polygon = ctx.aerodrome?.runways.find(
    (r) => r.polygon.length > 0,
  )?.polygon;
  if (!polygon || polygon.length === 0) return null;
  const latitude = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length;
  const longitude = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length;
  return { latitude, longitude };
}

export type WeatherAlertKind = "observed" | "forecast" | "vicinity";

export interface WeatherAlertInput {
  ctx: AlertContext;
  type: string;
  station: string;
  kind: WeatherAlertKind;
  severity: "WARNING" | "CRITICAL";
  message: string;
  /** Rincian yang ditampilkan di kartu alert. */
  details: Record<string, unknown>;
  /** Waktu kejadian: waktu laporan (pengamatan) atau waktu prakiraan mulai. */
  occursAt: Date;
}

/**
 * Alert cuaca tidak berasal dari satu pesawat. `trackId` diisi penanda stabil `WX-<stasiun>-<jenis>`
 * supaya tiap rule dan jenis (pengamatan, prakiraan) punya alert sendiri dan tidak bertabrakan
 * dengan track sungguhan.
 */
export function weatherCandidate(input: WeatherAlertInput): AlertCandidate {
  const { ctx, type, station, kind } = input;
  const marker =
    kind === "observed" ? "OBS" : kind === "forecast" ? "FCST" : "VC";
  const position = airportPosition(ctx);
  return {
    alertId: `${type}|${ctx.airportId}|${station}|${kind}`,
    airportId: ctx.airportId,
    type,
    severity: input.severity,
    status: "ACTIVE",
    trackId: `WX-${station}-${marker}`,
    triggeredAt: ctx.timestamp,
    data: {
      weather: true,
      station,
      kind,
      callsign: station,
      message: input.message,
      occursAt: input.occursAt.toISOString(),
      ...input.details,
      ...(position ?? {}),
    },
  };
}

/** Jam UTC `hhmmZ`, untuk pesan alert. */
export function utcClock(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}Z`;
}
