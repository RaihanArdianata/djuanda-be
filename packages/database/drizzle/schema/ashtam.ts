import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type { z } from "zod";

export const ASHTAM_STATUS_VALUES = ["ACTIVE", "CANCELLED", "EXPIRED"] as const;

export type AshtamStatus = (typeof ASHTAM_STATUS_VALUES)[number];

export const ashtamMessages = pgTable(
  "ashtam_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Identity: source + providerId
    source: text("source").notNull(),

    providerId: text("provider_id").notNull(),

    type: text("type").notNull().default("ASHTAM"),

    number: integer("number"),

    header: text("header"),

    affectedFir: text("affected_fir"),

    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }),

    effectiveTo: timestamp("effective_to", {
      withTimezone: true,
    }),

    volcanoName: text("volcano_name"),

    volcanoCoordinates: text("volcano_coordinates"),

    colourCode: text("colour_code"),

    volcanicAsh: text("volcanic_ash"),

    volcanicAshDirection: text("volcanic_ash_direction"),

    airRoutesAffected: text("air_routes_affected"),

    airRoutesClosure: text("air_routes_closure"),

    informationSource: text("information_source"),

    remark: text("remark"),

    status: text("status", {
      enum: ASHTAM_STATUS_VALUES,
    })
      .notNull()
      .default("ACTIVE"),

    contentHash: text("content_hash").notNull(),

    raw: text("raw").notNull(),

    providerRaw: jsonb("provider_raw").$type<Record<string, unknown>>(),

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
    unique("ashtam_messages_source_provider_id_unique").on(
      table.source,
      table.providerId,
    ),

    index("ashtam_messages_provider_id_idx").on(table.providerId),

    index("ashtam_messages_affected_fir_idx").on(table.affectedFir),

    index("ashtam_messages_volcano_name_idx").on(table.volcanoName),

    index("ashtam_messages_colour_code_idx").on(table.colourCode),

    index("ashtam_messages_status_idx").on(table.status),

    index("ashtam_messages_effective_from_idx").on(table.effectiveFrom),

    index("ashtam_messages_effective_to_idx").on(table.effectiveTo),
  ],
);

export const ashtamMessageSelectSchema = createSelectSchema(ashtamMessages);

export type AshtamMessage = z.infer<typeof ashtamMessageSelectSchema>;

export const ashtamMessageInsertSchema = createInsertSchema(ashtamMessages);

export type NewAshtamMessage = z.infer<typeof ashtamMessageInsertSchema>;
