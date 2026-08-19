CREATE TYPE "public"."feature_status" AS ENUM('ACTIVE', 'INACTIVE', 'RESTRICTED');--> statement-breakpoint
ALTER TABLE "aerodrome_features" ADD COLUMN "status" "feature_status";