-- Dedupe before adding the unique constraints below, in case retries under
-- the pre-fix ack-before-durability bug (docs/audit task 004) already wrote
-- duplicate rows — otherwise the ALTER TABLE ... ADD CONSTRAINT would fail
-- outright on any existing production data with a duplicate.
DELETE FROM "aeroswarm_alerts" a USING "aeroswarm_alerts" b
  WHERE a.ctid < b.ctid
    AND a.alert_id = b.alert_id
    AND a.triggered_at = b.triggered_at;--> statement-breakpoint
DELETE FROM "aeroswarm_tracks" a USING "aeroswarm_tracks" b
  WHERE a.ctid < b.ctid
    AND a.track_id = b.track_id
    AND a.fused_at = b.fused_at;--> statement-breakpoint
ALTER TABLE "aeroswarm_alerts" ADD CONSTRAINT "aeroswarm_alerts_alert_triggered_unique" UNIQUE("alert_id","triggered_at");--> statement-breakpoint
ALTER TABLE "aeroswarm_tracks" ADD CONSTRAINT "aeroswarm_tracks_track_fused_unique" UNIQUE("track_id","fused_at");