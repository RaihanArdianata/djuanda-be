CREATE TABLE "notam_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"provider_id" text NOT NULL,
	"header" text,
	"series" text NOT NULL,
	"number" text NOT NULL,
	"year" integer NOT NULL,
	"type" text NOT NULL,
	"fir" text,
	"icao_location" text NOT NULL,
	"qcode" text,
	"traffic" text,
	"purpose" text,
	"scope" text,
	"lower_limit" text,
	"upper_limit" text,
	"coordinates" text,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone NOT NULL,
	"schedule" text,
	"lower_altitude" text,
	"upper_altitude" text,
	"subject" text,
	"body" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"content_hash" text NOT NULL,
	"raw" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notam_messages_source_series_number_year_unique" UNIQUE("source","series","number","year")
);
--> statement-breakpoint
CREATE INDEX "notam_messages_provider_id_idx" ON "notam_messages" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "notam_messages_icao_location_idx" ON "notam_messages" USING btree ("icao_location");--> statement-breakpoint
CREATE INDEX "notam_messages_fir_idx" ON "notam_messages" USING btree ("fir");--> statement-breakpoint
CREATE INDEX "notam_messages_qcode_idx" ON "notam_messages" USING btree ("qcode");--> statement-breakpoint
CREATE INDEX "notam_messages_status_idx" ON "notam_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notam_messages_type_idx" ON "notam_messages" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notam_messages_effective_from_idx" ON "notam_messages" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "notam_messages_effective_to_idx" ON "notam_messages" USING btree ("effective_to");--> statement-breakpoint
CREATE INDEX "notam_messages_series_number_year_idx" ON "notam_messages" USING btree ("series","number","year");