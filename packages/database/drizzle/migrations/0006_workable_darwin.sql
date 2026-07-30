CREATE TABLE "weather_forecasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"raw" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"provider_raw" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weather_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station" text NOT NULL,
	"kind" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"raw" text NOT NULL,
	"parsed" jsonb NOT NULL,
	"provider_raw" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "weather_forecasts_station_valid_to_idx" ON "weather_forecasts" USING btree ("station","valid_to");--> statement-breakpoint
CREATE INDEX "weather_observations_station_observed_idx" ON "weather_observations" USING btree ("station","observed_at");