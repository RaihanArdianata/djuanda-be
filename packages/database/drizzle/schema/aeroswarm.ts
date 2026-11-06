import { type InferSelectModel, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const aeroswarmTracks = pgTable(
  "aeroswarm_tracks",
  {
    fusedAt: timestamp("fused_at", { withTimezone: true }).notNull(),
    trackId: text("track_id").notNull(),
    airportId: text("airport_id"),
    lifecycle: text("lifecycle"),
    targetType: text("target_type"),
    vehicleFleet: integer("vehicle_fleet"),
    altitudeFt: doublePrecision("altitude_ft"),
    groundSpeedKt: doublePrecision("ground_speed_kt"),
    onGround: boolean("on_ground"),
    data: jsonb("data").notNull(),
  },
  (t) => ({
    airportIdx: index("aeroswarm_tracks_airport_idx").on(
      t.airportId,
      t.fusedAt,
    ),
    trackUnique: unique("aeroswarm_tracks_track_fused_unique").on(
      t.trackId,
      t.fusedAt,
    ),
    fusedAtIdx: index("aeroswarm_tracks_fused_at_idx").on(t.fusedAt),
    trackFusedAtIdx: index("aeroswarm_tracks_track_fused_at_idx").on(
      t.trackId,
      t.fusedAt,
    ),
    // Jejak setelah restart (TRAIL_BACKFILL_MS) dicari per alamat Mode-S di jsonb. Di produksi buat dulu dengan
    // drizzle/manual/0025_aeroswarm_tracks_icao24_fused.sql (CONCURRENTLY); migrasinya memakai IF NOT EXISTS.
    icao24FusedIdx: index("idx_aeroswarm_tracks_icao24_fused").on(
      sql`(${t.data}->'identity'->>'icao24')`,
      t.fusedAt,
    ),
  }),
);

export const aeroswarmFlightplans = pgTable(
  "aeroswarm_flightplans",
  {
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    planId: text("plan_id").primaryKey(),
    airportId: text("airport_id"),
    data: jsonb("data").notNull(),
  },
  (t) => ({
    updatedAtIdx: index("aeroswarm_flightplans_updated_at_idx").on(t.updatedAt),
  }),
);

export const aeroswarmSourceHealth = pgTable(
  "aeroswarm_source_health",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sourceId: text("source_id").notNull(),
    airportId: text("airport_id"),
    status: text("status").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => ({
    observedAtIdx: index("aeroswarm_source_health_observed_at_idx").on(
      t.observedAt,
    ),
  }),
);

export const aeroswarmAlerts = pgTable(
  "aeroswarm_alerts",
  {
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
    alertId: text("alert_id").notNull(),
    airportId: text("airport_id"),
    type: text("type"),
    severity: text("severity"),
    trackId: text("track_id"),
    data: jsonb("data").notNull(),
  },
  (t) => ({
    airportIdx: index("aeroswarm_alerts_airport_idx").on(
      t.airportId,
      t.triggeredAt,
    ),
    typeIdx: index("aeroswarm_alerts_type_idx").on(t.type, t.triggeredAt),
    alertUnique: unique("aeroswarm_alerts_alert_triggered_unique").on(
      t.alertId,
      t.triggeredAt,
    ),
  }),
);

export const aeroswarmMovements = pgTable(
  "aeroswarm_movements",
  {
    id: text("id"),
    airportId: text("airport_id"),
    trackId: text("track_id").notNull(),
    icao24: text("icao24"),
    callsign: text("callsign"),
    type: text("type").notNull(),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => ({
    airportIdx: index("aeroswarm_movements_airport_idx").on(t.airportId, t.at),
    movementUnique: unique("aeroswarm_movements_track_type_at_unique").on(
      t.trackId,
      t.type,
      t.at,
    ),
  }),
);

export type AeroswarmTrack = InferSelectModel<typeof aeroswarmTracks>;
export type AeroswarmAlert = InferSelectModel<typeof aeroswarmAlerts>;
export type AeroswarmMovement = InferSelectModel<typeof aeroswarmMovements>;
export type AeroswarmFlightplan = InferSelectModel<typeof aeroswarmFlightplans>;
export type AeroswarmSourceHealth = InferSelectModel<
  typeof aeroswarmSourceHealth
>;
