ALTER TABLE "alert_rules" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "documentation" jsonb DEFAULT '{}'::jsonb NOT NULL;