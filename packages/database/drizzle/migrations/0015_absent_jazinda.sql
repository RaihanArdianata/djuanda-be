ALTER TABLE "aerodrome_features" ADD COLUMN "airport_id" varchar(20);--> statement-breakpoint
CREATE INDEX "aerodrome_features_airport_id_idx" ON "aerodrome_features" USING btree ("airport_id");