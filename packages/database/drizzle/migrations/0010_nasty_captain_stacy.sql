CREATE TABLE "aeroswarm_movements" (
	"id" text,
	"airport_id" text,
	"track_id" text NOT NULL,
	"icao24" text,
	"callsign" text,
	"type" text NOT NULL,
	"lat" double precision,
	"lon" double precision,
	"at" timestamp with time zone NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "aeroswarm_movements_track_type_at_unique" UNIQUE("track_id","type","at")
);
--> statement-breakpoint
CREATE INDEX "aeroswarm_movements_airport_idx" ON "aeroswarm_movements" USING btree ("airport_id","at");