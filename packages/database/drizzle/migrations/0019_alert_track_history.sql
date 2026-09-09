CREATE TABLE "alert_track_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" text NOT NULL,
	"track_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_type" text,
	"callsign" text,
	"registration" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"altitude" double precision,
	"ground_speed" double precision,
	"heading" double precision,
	"on_ground" boolean,
	"timestamp" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "alert_track_history_alert_id_fk" FOREIGN KEY ("alert_id") REFERENCES "alerts"("alert_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "alert_track_history_alert_id_idx" ON "alert_track_history" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "alert_track_history_track_id_idx" ON "alert_track_history" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "alert_track_history_timestamp_idx" ON "alert_track_history" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "alert_track_history_alert_track_idx" ON "alert_track_history" USING btree ("alert_id","track_id","timestamp");
