CREATE TYPE "public"."notam_status_enum" AS ENUM('ACTIVE', 'REPLACED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "notams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"series" text NOT NULL,
	"number" text NOT NULL,
	"year" integer NOT NULL,
	"icao_location" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" "notam_status_enum" DEFAULT 'ACTIVE' NOT NULL,
	"source" text NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notams_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
CREATE INDEX "notams_icao_location_idx" ON "notams" USING btree ("icao_location");--> statement-breakpoint
CREATE INDEX "notams_status_idx" ON "notams" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notams_effective_date_idx" ON "notams" USING btree ("effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "notams_series_number_year_idx" ON "notams" USING btree ("series","number","year");