import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const playbackFiles = pgTable(
  "playback_files",
  {
    id: text("id").primaryKey(),
    airportId: text("airport_id").notNull(),
    kind: text("kind").notNull(), // generated | imported
    displayName: text("display_name").notNull(),
    originalFileName: text("original_file_name"),
    notes: text("notes"),
    source: text("source").notNull().default("asmgcs"),
    status: text("status").notNull(), // uploading | processing | ready | failed
    progress: integer("progress").notNull().default(0),
    storageKey: text("storage_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    recordCount: integer("record_count"),
    uniqueTrackCount: integer("unique_track_count"),
    recordingFrom: timestamp("recording_from", { withTimezone: true }),
    recordingTo: timestamp("recording_to", { withTimezone: true }),
    requestedFrom: timestamp("requested_from", { withTimezone: true }),
    requestedTo: timestamp("requested_to", { withTimezone: true }),
    stats: jsonb("stats").$type<Record<string, unknown>>(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    importedAt: timestamp("imported_at", { withTimezone: true }),
  },
  (t) => [
    index("playback_files_status_created_idx").on(t.status, t.createdAt),
    index("playback_files_airport_idx").on(t.airportId, t.createdAt),
    uniqueIndex("playback_files_storage_key_unique").on(t.storageKey),
  ],
);
