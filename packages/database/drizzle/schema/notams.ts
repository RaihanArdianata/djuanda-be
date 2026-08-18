import type { InferSelectModel } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const notamStatusEnum = pgEnum("notam_status_enum", [
  "ACTIVE",
  "REPLACED",
  "CANCELLED",
  "EXPIRED",
]);

export const notams = pgTable(
  "notams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    providerId: text("provider_id").notNull(),
    series: text("series").notNull(),
    number: text("number").notNull(),
    year: integer("year").notNull(),
    icaoLocation: text("icao_location").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }).notNull(),
    estimated: boolean("estimated").default(false).notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: notamStatusEnum("status").default("ACTIVE").notNull(),
    source: text("source").notNull(),
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    providerIdUnique: unique("notams_provider_id_unique").on(t.providerId),
    icaoLocationIdx: index("notams_icao_location_idx").on(t.icaoLocation),
    statusIdx: index("notams_status_idx").on(t.status),
    effectiveDateIdx: index("notams_effective_date_idx").on(
      t.effectiveFrom,
      t.effectiveTo,
    ),
    seriesNumberYearIdx: index("notams_series_number_year_idx").on(
      t.series,
      t.number,
      t.year,
    ),
  }),
);

export type Notam = InferSelectModel<typeof notams>;
