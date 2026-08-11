ALTER TABLE "notams" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "notams" CASCADE;--> statement-breakpoint
ALTER TABLE "aerodrome_features" ALTER COLUMN "layer" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "aerodrome_import_features" ALTER COLUMN "layer" SET DATA TYPE varchar(64);--> statement-breakpoint
DROP TYPE "public"."layer";--> statement-breakpoint
DROP TYPE "public"."notam_status_enum";