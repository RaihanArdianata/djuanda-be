import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
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
    index("alerts_type_idx").on(t.type, t.triggeredAt),
    index("alerts_track_idx").on(t.trackId, t.triggeredAt),
  ],
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    airportId: text("airport_id").notNull(),
    type: text("type").notNull(),
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
export type AlertRule = InferSelectModel<typeof alertRules>;
