ALTER TABLE "aeroswarm_tracks" ADD COLUMN "target_type" text;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "vehicle_fleet" integer;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "altitude_ft" double precision;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "ground_speed_kt" double precision;--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD COLUMN "on_ground" boolean;