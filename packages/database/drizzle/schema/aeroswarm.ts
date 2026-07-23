import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

// Filled by AeroSwarm's analytics connector (process-service → PostgresSink),
// one row per fused track / alert event. AeroSwarm itself no longer stores
// this data locally — see aeroswarm-project's storage-service (management
// only) and services/process-service/src/modules/publishing/analytics-connector.ts.
//
// Converted to TimescaleDB hypertables + extra indexes in a follow-up
// migration (drizzle-kit can't express create_hypertable()) — see
// drizzle/migrations after running `db:generate`.
//
// icao24/callsign live under data->'identity' (nested, not a column) —
// query them out via data->'identity'->>'icao24'.
export const aeroswarmTracks = pgTable(
  "aeroswarm_tracks",
  {
    fusedAt: timestamp("fused_at", { withTimezone: true }).notNull(),
    trackId: text("track_id").notNull(),
    airportId: text("airport_id"),
    lifecycle: text("lifecycle"),
    data: jsonb("data").notNull(),
  },
  (t) => ({
    airportIdx: index("aeroswarm_tracks_airport_idx").on(
      t.airportId,
      t.fusedAt,
    ),
    // Must include the hypertable's partitioning column (fused_at) —
    // TimescaleDB requires unique constraints on a hypertable to cover the
    // time dimension. Backs .onConflictDoNothing() in ingest.service.ts so
    // AeroSwarm's retry-on-lost-ack (see docs/audit task 004) can't produce
    // duplicate rows for the same fused-track event.
    trackUnique: unique("aeroswarm_tracks_track_fused_unique").on(
      t.trackId,
      t.fusedAt,
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
    // (alert_id, triggered_at) rather than alert_id alone: TimescaleDB
    // requires a hypertable's unique constraints to cover the partitioning
    // column (triggered_at). Re-delivery of the same alert re-triggered at
    // a later time is treated as a distinct row by design — only exact
    // retries (same id + same triggeredAt) are deduped.
    alertUnique: unique("aeroswarm_alerts_alert_triggered_unique").on(
      t.alertId,
      t.triggeredAt,
    ),
  }),
);

export type AeroswarmTrack = InferSelectModel<typeof aeroswarmTracks>;
export type AeroswarmAlert = InferSelectModel<typeof aeroswarmAlerts>;
