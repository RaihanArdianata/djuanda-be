CREATE TABLE "aeroswarm_alerts" (
	"triggered_at" timestamp with time zone NOT NULL,
	"alert_id" text NOT NULL,
	"airport_id" text,
	"type" text,
	"severity" text,
	"track_id" text,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aeroswarm_tracks" (
	"fused_at" timestamp with time zone NOT NULL,
	"track_id" text NOT NULL,
	"airport_id" text,
	"lifecycle" text,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "aeroswarm_alerts_airport_idx" ON "aeroswarm_alerts" USING btree ("airport_id","triggered_at");--> statement-breakpoint
CREATE INDEX "aeroswarm_alerts_type_idx" ON "aeroswarm_alerts" USING btree ("type","triggered_at");--> statement-breakpoint
CREATE INDEX "aeroswarm_tracks_airport_idx" ON "aeroswarm_tracks" USING btree ("airport_id","fused_at");--> statement-breakpoint
-- Convert to TimescaleDB hypertables (partition by time, not expressible via
-- drizzle schema) — safe to re-run, if_not_exists guards both.
SELECT create_hypertable('aeroswarm_tracks', 'fused_at', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);--> statement-breakpoint
SELECT create_hypertable('aeroswarm_alerts', 'triggered_at', chunk_time_interval => INTERVAL '1 day', if_not_exists => TRUE);