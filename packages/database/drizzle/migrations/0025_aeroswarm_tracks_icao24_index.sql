-- Jejak setelah restart (TRAIL_BACKFILL_MS) dicari per alamat Mode-S: data->'identity'->>'icao24' = $1, urut fused_at.
-- IF NOT EXISTS: di produksi indeks ini dibuat lebih dulu dengan CONCURRENTLY lewat
-- drizzle/manual/0025_aeroswarm_tracks_icao24_fused.sql (CREATE INDEX biasa mengunci tulis ke tabel selama dibangun,
-- dan CONCURRENTLY tidak bisa jalan di dalam transaksi migrasi). Bila sudah ada, migrasi ini tidak berbuat apa-apa.
CREATE INDEX IF NOT EXISTS "idx_aeroswarm_tracks_icao24_fused" ON "aeroswarm_tracks" USING btree (("data"->'identity'->>'icao24'),"fused_at");
