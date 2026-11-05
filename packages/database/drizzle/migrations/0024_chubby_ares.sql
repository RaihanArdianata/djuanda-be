CREATE TABLE "weather_sync_metadata" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station" text NOT NULL,
	"last_successful_sync_at" timestamp with time zone,
	"last_sync_status" text DEFAULT 'NEVER' NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_sync_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "weather_sync_metadata_station_idx" ON "weather_sync_metadata" USING btree ("station");