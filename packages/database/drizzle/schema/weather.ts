import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// Shape produced by modules/weather/parser/metar.parser.ts and
// modules/weather/parser/taf.parser.ts (apps/weather-service) — kept here,
// next to the columns that store it, so the DB layer and the app layer
// share one definition instead of duplicating it.
export interface WeatherParsedCloud {
  cover: string;
  baseFt: number | null;
}

export interface MetarParsedData {
  windDirection: number | null;
  windDirectionVariable: boolean;
  windSpeedKt: number | null;
  gustKt: number | null;
  visibilityM: number | null;
  temperatureC: number | null;
  dewPointC: number | null;
  qnhHpa: number | null;
  clouds: WeatherParsedCloud[];
  phenomena: string[];
  cavok: boolean;
  nosig: boolean;
  hasRvr: boolean;
  partial: boolean;
}

export interface TafParsedPeriod {
  changeType: string | null;
  probability: number | null;
  timeFrom: string;
  timeTo: string;
  windDirection: number | null;
  windDirectionVariable: boolean;
  windSpeedKt: number | null;
  gustKt: number | null;
  visibilityM: number | null;
  weather: string[];
  clouds: WeatherParsedCloud[];
}

export interface TafParsedData {
  periods: TafParsedPeriod[];
  partial: boolean;
}

// Filled by weather-service's poller
// (modules/weather/service/weather-poller.ts), one row per successful
// METAR/SPECI poll — a failed poll never writes a row, so
// GET /weather/current always serves the latest row that exists, flagged
// stale at read time (modules/weather/lib/staleness.ts) rather than a
// stored column.
export const weatherObservations = pgTable(
  "weather_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    station: text("station").notNull(),
    kind: text("kind").notNull(), // METAR | SPECI
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    raw: text("raw").notNull(),
    parsed: jsonb("parsed").$type<MetarParsedData>().notNull(),
    providerRaw: jsonb("provider_raw")
      .$type<Record<string, unknown>>()
      .notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) =>[index("weather_observations_station_observed_idx").on(
      t.station,
      t.observedAt,
    ),],
);

// Filled by the same poller, one row per successful TAF poll.
export const weatherForecasts = pgTable(
  "weather_forecasts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    station: text("station").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }).notNull(),
    raw: text("raw").notNull(),
    parsed: jsonb("parsed").$type<TafParsedData>().notNull(),
    providerRaw: jsonb("provider_raw")
      .$type<Record<string, unknown>>()
      .notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("weather_forecasts_station_valid_to_idx").on(
      t.station,
      t.validTo,
    ),
  ],
);

export type WeatherObservation = InferSelectModel<typeof weatherObservations>;
export type WeatherForecast = InferSelectModel<typeof weatherForecasts>;