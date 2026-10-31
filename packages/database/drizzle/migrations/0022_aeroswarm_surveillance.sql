CREATE TABLE IF NOT EXISTS "aeroswarm_flightplans" (
	"updated_at" timestamp with time zone NOT NULL,
	"plan_id" text PRIMARY KEY NOT NULL,
	"airport_id" text,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aeroswarm_flightplans_updated_at_idx" ON "aeroswarm_flightplans" USING btree ("updated_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "aeroswarm_source_health" (
	"observed_at" timestamp with time zone NOT NULL,
	"source_id" text NOT NULL,
	"airport_id" text,
	"status" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aeroswarm_source_health_observed_at_idx" ON "aeroswarm_source_health" USING btree ("observed_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aeroswarm_tracks_fused_at_idx" ON "aeroswarm_tracks" USING btree ("fused_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "aeroswarm_tracks_track_fused_at_idx" ON "aeroswarm_tracks" USING btree ("track_id", "fused_at");
