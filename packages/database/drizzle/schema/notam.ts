import type { InferSelectModel } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const NOTAM_TYPE_VALUES = ["NOTAMN", "NOTAMR", "NOTAMC"] as const;
export type NotamMessageType = (typeof NOTAM_TYPE_VALUES)[number];

export const NOTAM_STATUS_VALUES = [
  "ACTIVE",
  "REPLACED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type NotamMessageStatus = (typeof NOTAM_STATUS_VALUES)[number];

export const notamMessages = pgTable(
  "notam_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    providerId: text("provider_id").notNull(),
    header: text("header"),
    series: text("series").notNull(),
    number: text("number").notNull(),
    year: integer("year").notNull(),
    type: text("type", { enum: NOTAM_TYPE_VALUES }).notNull(),
    fir: text("fir"),
    icaoLocation: text("icao_location").notNull(),
    qcode: text("qcode"),
    traffic: text("traffic"),
    purpose: text("purpose"),
    scope: text("scope"),
    lowerLimit: text("lower_limit"),
    upperLimit: text("upper_limit"),
    coordinates: text("coordinates"),

    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", {
      withTimezone: true,
    }).notNull(),
    schedule: text("schedule"),

    lowerAltitude: text("lower_altitude"),
    upperAltitude: text("upper_altitude"),

    subject: text("subject"),
    body: text("body").notNull(),

    status: text("status", { enum: NOTAM_STATUS_VALUES })
      .notNull()
      .default("ACTIVE"),

    contentHash: text("content_hash").notNull(),

    raw: text("raw").notNull(),

    createdAt: timestamp("created_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),

    updatedAt: timestamp("updated_at", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("notam_messages_source_series_number_year_unique").on(
      table.source,
      table.series,
      table.number,
      table.year,
    ),

    index("notam_messages_provider_id_idx").on(table.providerId),
    index("notam_messages_icao_location_idx").on(table.icaoLocation),
    index("notam_messages_fir_idx").on(table.fir),
    index("notam_messages_qcode_idx").on(table.qcode),
    index("notam_messages_status_idx").on(table.status),
    index("notam_messages_type_idx").on(table.type),
    index("notam_messages_effective_from_idx").on(table.effectiveFrom),
    index("notam_messages_effective_to_idx").on(table.effectiveTo),
    index("notam_messages_series_number_year_idx").on(
      table.series,
      table.number,
      table.year,
    ),
  ],
);

export type NotamMessage = InferSelectModel<typeof notamMessages>;
