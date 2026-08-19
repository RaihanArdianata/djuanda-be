CREATE TABLE "alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"airport_id" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" text NOT NULL,
	"airport_id" text NOT NULL,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"track_id" text NOT NULL,
	"related_track_id" text,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" text,
	"cleared_at" timestamp with time zone,
	"cleared_by" text,
	"notam_id" text,
	"ashtam_id" text,
	"aftn_message_id" text,
	"aerodrome_feature_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alerts_alert_id_unique" UNIQUE("alert_id")
);
--> statement-breakpoint
CREATE INDEX "alert_rules_airport_type_idx" ON "alert_rules" USING btree ("airport_id","type");--> statement-breakpoint
CREATE INDEX "alert_rules_type_idx" ON "alert_rules" USING btree ("type");--> statement-breakpoint
CREATE INDEX "alerts_airport_status_idx" ON "alerts" USING btree ("airport_id","status","triggered_at");--> statement-breakpoint
CREATE INDEX "alerts_type_idx" ON "alerts" USING btree ("type","triggered_at");--> statement-breakpoint
CREATE INDEX "alerts_track_idx" ON "alerts" USING btree ("track_id","triggered_at");