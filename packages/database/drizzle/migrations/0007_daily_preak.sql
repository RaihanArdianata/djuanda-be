CREATE TYPE "public"."import_mode" AS ENUM('APPEND', 'REPLACE');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('DRAFT', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."layer" AS ENUM('AERODROME', 'AEROWAY', 'RUNWAY', 'TAXIWAY', 'APRON', 'TERMINAL', 'PARKING', 'BUILDING', 'WATCH_TOWER', 'POINT_OF_INTEREST', 'GRASS', 'GARDEN', 'WATER');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('VALID', 'INVALID');--> statement-breakpoint
CREATE TABLE "aerodrome_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"layer" "layer" NOT NULL,
	"name" varchar(255),
	"geometry" jsonb NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" varchar(255),
	"updated_by" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "aerodrome_import_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"layer" "layer" NOT NULL,
	"geometry" jsonb NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_status" "validation_status" DEFAULT 'INVALID' NOT NULL,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aerodrome_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mode" "import_mode" DEFAULT 'APPEND' NOT NULL,
	"status" "import_status" DEFAULT 'DRAFT' NOT NULL,
	"total_features" integer DEFAULT 0 NOT NULL,
	"valid_features" integer DEFAULT 0 NOT NULL,
	"invalid_features" integer DEFAULT 0 NOT NULL,
	"created_by" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aerodrome_import_features" ADD CONSTRAINT "aerodrome_import_features_import_id_aerodrome_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."aerodrome_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aerodrome_features_layer_idx" ON "aerodrome_features" USING btree ("layer");