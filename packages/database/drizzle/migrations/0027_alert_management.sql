ALTER TABLE "alerts" ADD COLUMN "clear_reason" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "verification_status" text DEFAULT 'UNVERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "verified_by" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "verification_note" text;--> statement-breakpoint
ALTER TABLE "alerts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "alerts_verification_status_idx" ON "alerts" USING btree ("verification_status");--> statement-breakpoint
CREATE TABLE "alert_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"previous_status" text,
	"new_status" text,
	"previous_verification_status" text,
	"new_verification_status" text,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_actions" ADD CONSTRAINT "alert_actions_alert_id_alerts_alert_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("alert_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_actions_alert_id_idx" ON "alert_actions" USING btree ("alert_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_actions_created_at_idx" ON "alert_actions" USING btree ("created_at");
