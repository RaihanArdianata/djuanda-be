ALTER TABLE "auth_tokens" ADD COLUMN "refresh_token" varchar(255);--> statement-breakpoint
CREATE INDEX "auth_tokens_user_id_idx" ON "auth_tokens" USING btree ("user_id","is_active","expires_at");--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_refresh_token_unique" UNIQUE("refresh_token");