-- Nullable columns without a default: Postgres only records them in the catalogue, the table is not rewritten and not locked
-- for long. Rows stored before this keep NULL (the same facts are in the jsonb `data`).
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "icao24" text;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "callsign" text;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "aircraft_type" text;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "track_number" integer;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "protocol" text;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "sac" smallint;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "sic" smallint;