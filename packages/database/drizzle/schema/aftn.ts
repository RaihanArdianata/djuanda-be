import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createSelectSchema } from "drizzle-zod";
import type z from "zod";

export const AFTN_MESSAGE_TYPE_VALUES = [
  "FPL",
  "DEP",
  "ARR",
  "DLA",
  "CHG",
] as const;

export type AftnMessageType = (typeof AFTN_MESSAGE_TYPE_VALUES)[number];

export interface AftnParsedExtras {
  [key: string]: unknown;
}

export const aftnMessages = pgTable(
  "aftn_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    providerId: text("provider_id").notNull(),

    contentHash: text("content_hash").notNull(),
    datetime: timestamp("datetime", { withTimezone: true }).notNull(),
    messageType: text("message_type").notNull(),
    callSign: text("call_sign"),
    registration: text("registration"),
    aircraftType: text("aircraft_type"),
    departure: text("departure"),
    departureTime: text("departure_time"),
    destination: text("destination"),
    destinationTime: text("destination_time"),
    duration: text("duration"),
    speed: text("speed"),
    altitude: text("altitude"),
    route: text("route"),
    raw: text("raw").notNull(),
    parsed: jsonb("parsed").$type<AftnParsedExtras>().notNull().default({}),
    providerRaw: jsonb("provider_raw")
      .$type<Record<string, unknown>>()
      .notNull(),
    source: text("source").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    unique("aftn_messages_provider_id_unique").on(t.providerId),
    index("aftn_messages_datetime_idx").on(t.datetime),
    index("aftn_messages_message_type_datetime_idx").on(
      t.messageType,
      t.datetime,
    ),
    index("aftn_messages_call_sign_idx").on(t.callSign),
    index("aftn_messages_registration_idx").on(t.registration),
    index("aftn_messages_aircraft_type_idx").on(t.aircraftType),
    index("aftn_messages_departure_idx").on(t.departure),
    index("aftn_messages_destination_idx").on(t.destination),
  ],
);

export const aftnMessagesSelectSchema = createSelectSchema(aftnMessages);

export type AftnMessage = z.infer<typeof aftnMessagesSelectSchema>;
