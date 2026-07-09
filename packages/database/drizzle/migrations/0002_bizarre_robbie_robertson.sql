CREATE TYPE "public"."users_status_enum" AS ENUM('ACTIVE', 'INACTIVE', 'DELETED');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" "users_status_enum" DEFAULT 'ACTIVE';--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id","revoked_at","expires_at");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "last_name";