CREATE TABLE "ashtam_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"provider_id" text NOT NULL,
	"type" text DEFAULT 'ASHTAM' NOT NULL,
	"number" integer,
	"header" text,
	"affected_fir" text,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"volcano_name" text,
	"volcano_coordinates" text,
	"colour_code" text,
	"volcanic_ash" text,
	"volcanic_ash_direction" text,
	"air_routes_affected" text,
	"air_routes_closure" text,
	"information_source" text,
	"remark" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"content_hash" text NOT NULL,
	"raw" text NOT NULL,
	"provider_raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ashtam_messages_source_provider_id_unique" UNIQUE("source","provider_id")
);
--> statement-breakpoint
CREATE INDEX "ashtam_messages_provider_id_idx" ON "ashtam_messages" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "ashtam_messages_affected_fir_idx" ON "ashtam_messages" USING btree ("affected_fir");--> statement-breakpoint
CREATE INDEX "ashtam_messages_volcano_name_idx" ON "ashtam_messages" USING btree ("volcano_name");--> statement-breakpoint
CREATE INDEX "ashtam_messages_colour_code_idx" ON "ashtam_messages" USING btree ("colour_code");--> statement-breakpoint
CREATE INDEX "ashtam_messages_status_idx" ON "ashtam_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ashtam_messages_effective_from_idx" ON "ashtam_messages" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "ashtam_messages_effective_to_idx" ON "ashtam_messages" USING btree ("effective_to");