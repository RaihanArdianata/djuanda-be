-- Jalankan SEKALI di produksi SEBELUM `db:migrate` (atau kapan saja, nanti migrasi 0025 jadi tanpa efek).
-- CONCURRENTLY: tidak mengunci tulis ke aeroswarm_tracks selama indeks dibangun (tabel ini menerima track terus-menerus).
-- Tidak boleh di dalam transaksi, jadi tidak ikut drizzle-kit migrate. Pakai koneksi LANGSUNG ke Postgres, bukan lewat
-- pgbouncer (query_timeout-nya bisa memutus pembangunan indeks yang lama). Contoh:
--
--   psql "$DATABASE_URL_DIRECT" -f packages/database/drizzle/manual/0025_aeroswarm_tracks_icao24_fused.sql
--
-- Bila gagal di tengah jalan, Postgres meninggalkan indeks INVALID: hapus lalu ulangi.
--   DROP INDEX CONCURRENTLY IF EXISTS idx_aeroswarm_tracks_icao24_fused;
-- Cek hasilnya (indisvalid harus t):
--   SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid = 'idx_aeroswarm_tracks_icao24_fused'::regclass;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_aeroswarm_tracks_icao24_fused
  ON aeroswarm_tracks ((data->'identity'->>'icao24'), fused_at);
