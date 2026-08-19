CREATE TABLE "aftn_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"datetime" timestamp with time zone NOT NULL,
	"message_type" text NOT NULL,
	"call_sign" text,
	"registration" text,
	"aircraft_type" text,
	"departure" text,
	"departure_time" text,
	"destination" text,
	"destination_time" text,
	"duration" text,
	"speed" text,
	"altitude" text,
	"route" text,
	"raw" text NOT NULL,
	"parsed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_raw" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aftn_messages_provider_id_unique" UNIQUE("provider_id")
);
--> statement-breakpoint
ALTER TABLE "aerodrome_features" ALTER COLUMN "layer" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "aerodrome_import_features" ALTER COLUMN "layer" SET DATA TYPE varchar(64);--> statement-breakpoint
CREATE INDEX "aftn_messages_datetime_idx" ON "aftn_messages" USING btree ("datetime");--> statement-breakpoint
CREATE INDEX "aftn_messages_message_type_datetime_idx" ON "aftn_messages" USING btree ("message_type","datetime");--> statement-breakpoint
CREATE INDEX "aftn_messages_call_sign_idx" ON "aftn_messages" USING btree ("call_sign");--> statement-breakpoint
CREATE INDEX "aftn_messages_registration_idx" ON "aftn_messages" USING btree ("registration");--> statement-breakpoint
CREATE INDEX "aftn_messages_aircraft_type_idx" ON "aftn_messages" USING btree ("aircraft_type");--> statement-breakpoint
CREATE INDEX "aftn_messages_departure_idx" ON "aftn_messages" USING btree ("departure");--> statement-breakpoint
CREATE INDEX "aftn_messages_destination_idx" ON "aftn_messages" USING btree ("destination");--> statement-breakpoint
DROP TYPE IF EXISTS "public"."layer";