-- Hanya membaca. Jalankan sebelum dan sesudah membangun indeks:
--   bun run db:manual drizzle/manual/0025_check.sql

-- 1) Build indeks yang masih berjalan atau tertahan (harus kosong kalau tidak ada yang sedang membangun)
SELECT pid, state, wait_event_type, now() - query_start AS umur, left(query, 90) AS query
FROM pg_stat_activity
WHERE query ILIKE '%idx_aeroswarm_tracks_icao24_fused%' AND pid <> pg_backend_pid();

-- 2) Sesi yang menunggu kunci (ada yang terlalu lama = ada yang memblokir)
SELECT pid, now() - query_start AS umur, left(query, 80) AS query
FROM pg_stat_activity WHERE wait_event_type = 'Lock' ORDER BY umur DESC;

-- 3) Keadaan indeks: tidak ada baris = belum ada; indisvalid = f berarti rusak (hapus lalu ulangi)
SELECT indexrelid::regclass AS indeks, indisvalid
FROM pg_index WHERE indexrelid = to_regclass('idx_aeroswarm_tracks_icao24_fused');

-- 4) Ukuran tabel, untuk memperkirakan lama pembangunan
SELECT pg_size_pretty(pg_total_relation_size('aeroswarm_tracks')) AS ukuran,
       (SELECT reltuples::bigint FROM pg_class WHERE relname = 'aeroswarm_tracks') AS perkiraan_baris;
