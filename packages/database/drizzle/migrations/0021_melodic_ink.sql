CREATE TABLE "playback_files" (
	"id" text PRIMARY KEY NOT NULL,
	"airport_id" text NOT NULL,
	"kind" text NOT NULL,
	"display_name" text NOT NULL,
	"original_file_name" text,
	"notes" text,
	"source" text DEFAULT 'asmgcs' NOT NULL,
	"status" text NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint,
	"record_count" integer,
	"unique_track_count" integer,
	"recording_from" timestamp with time zone,
	"recording_to" timestamp with time zone,
	"requested_from" timestamp with time zone,
	"requested_to" timestamp with time zone,
	"stats" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"imported_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "playback_files_status_created_idx" ON "playback_files" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "playback_files_airport_idx" ON "playback_files" USING btree ("airport_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "playback_files_storage_key_unique" ON "playback_files" USING btree ("storage_key");