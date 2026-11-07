import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    alertId: text("alert_id").notNull().unique(),
    airportId: text("airport_id").notNull(),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    status: text("status").notNull().default("ACTIVE"),
    trackId: text("track_id").notNull(),
    relatedTrackId: text("related_track_id"),
    triggeredAt: timestamp("triggered_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedBy: text("acknowledged_by"),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedBy: text("cleared_by"),
    clearReason: text("clear_reason"),
    verificationStatus: text("verification_status")
      .notNull()
      .default("UNVERIFIED"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verifiedBy: text("verified_by"),
    verificationNote: text("verification_note"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    notamId: text("notam_id"),
    ashtamId: text("ashtam_id"),
    aftnMessageId: text("aftn_message_id"),
    aerodromeFeatureId: text("aerodrome_feature_id"),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("alerts_airport_status_idx").on(t.airportId, t.status, t.triggeredAt),
    index("alerts_airport_triggered_idx").on(t.airportId, t.triggeredAt),
    index("alerts_type_idx").on(t.type, t.triggeredAt),
    index("alerts_track_idx").on(t.trackId, t.triggeredAt),
    index("alerts_verification_status_idx").on(t.verificationStatus),
  ],
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    airportId: text("airport_id").notNull(),
    type: text("type").notNull(),
    description: text("description"),
    documentation: jsonb("documentation").notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    configuration: jsonb("configuration").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("alert_rules_airport_type_idx").on(t.airportId, t.type),
    index("alert_rules_type_idx").on(t.type),
  ],
);

export type Alert = InferSelectModel<typeof alerts>;
export type NewAlert = InferInsertModel<typeof alerts>;
export type AlertRule = InferSelectModel<typeof alertRules>;
export type NewAlertRule = InferInsertModel<typeof alertRules>;

export const alertTrackHistory = pgTable(
  "alert_track_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    alertId: text("alert_id")
      .notNull()
      .references(() => alerts.alertId, { onDelete: "cascade" }),
    trackId: text("track_id").notNull(),
    kind: text("kind").notNull(), // "main" | "related"
    targetType: text("target_type"),
    callsign: text("callsign"),
    registration: text("registration"),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    altitude: doublePrecision("altitude"),
    groundSpeed: doublePrecision("ground_speed"),
    heading: doublePrecision("heading"),
    onGround: boolean("on_ground"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("alert_track_history_alert_id_idx").on(t.alertId),
    index("alert_track_history_track_id_idx").on(t.trackId),
    index("alert_track_history_timestamp_idx").on(t.timestamp),
    index("alert_track_history_alert_track_idx").on(
      t.alertId,
      t.trackId,
      t.timestamp,
    ),
  ],
);

export type AlertTrackHistory = InferSelectModel<typeof alertTrackHistory>;

export const alertActions = pgTable(
  "alert_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    alertId: text("alert_id")
      .notNull()
      .references(() => alerts.alertId, { onDelete: "cascade" }),
    action: text("action").notNull(), // "ACKNOWLEDGE" | "CLEAR" | "VERIFY" | "DELETE"
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    previousStatus: text("previous_status"),
    newStatus: text("new_status"),
    previousVerificationStatus: text("previous_verification_status"),
    newVerificationStatus: text("new_verification_status"),
    note: text("note"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("alert_actions_alert_id_idx").on(t.alertId, t.createdAt),
    index("alert_actions_created_at_idx").on(t.createdAt),
  ],
);

export type AlertAction = InferSelectModel<typeof alertActions>;
export type NewAlertAction = InferInsertModel<typeof alertActions>;
