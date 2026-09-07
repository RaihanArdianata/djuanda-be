To install dependencies:
```sh
bun install
```

To run:
```sh
bun run dev
```

open http://localhost:3000

## Setup Lokal

### Persyaratan

- Docker Desktop (Windows) atau Docker Engine (Linux)
- Bun (disarankan) dan Node.js

### 1. Environment

Salin salah satu template ke `.env`:

```powershell
cp .env.example .env
# atau gunakan default lokal yang sudah disiapkan:
cp .env.development .env
```

Sesuaikan `POSTGRES_*`, `DATABASE_URL`, `REDIS_*`, dan `ADVISORY_PROVIDER_*` sesuai kebutuhan.

### 2. Install dependencies

```powershell
bun install
```

### 3. Jalankan infrastruktur Docker

```powershell
docker compose --env-file .env.development -f docker-compose.yml -f docker-compose.local.yml up -d
```

Pastikan `postgres`, `pgbouncer`, `redis`, dan `redpanda` healthy:

Postgres pakai image `timescale/timescaledb` karena project menggunakan `create_hypertable`. Ekstensi diaktifkan otomatis via `init-timescaledb.sql`.

### 4. Database migration

```powershell
cd packages/database
bun --env-file=../../.env run db:migrate
```

### 5. Seed data

```powershell
bun --env-file=../../.env run seed.ts
bun --env-file=../../.env run seed-alert-rules.ts
```

### 6. Jalankan satu service di host

```powershell
cd apps/aerodrome-service
bun --env-file=../../.env run --hot src/index.ts
```

Setiap app juga punya script `dev` di `package.json`.

### Catatan

- `.env.development` isinya default lokal (`localhost`, PostgreSQL `postgres`/`backend_djuanda`).
- `DATABASE_URL` di `.env` kamu aktif saat ini pakai `pgbouncer` (`:6432`) untuk container Docker, atau direct ke `localhost:5432` untuk `bun` di host.
- Kalau muncul error `relation "weather_forecasts" does not exist`, berarti migration belum dijalankan — ulangi langkah 4.

## Integrasi dengan AeroSwarm (backend baru)

Agar backend baru bisa menerima dan menyajikan replay data dari/ke AeroSwarm, setelah deploy pastikan env berikut sesuai:

| Variabel | Sumber / nilai | Catatan |
|---|---|---|
| `CONNECTION_SERVICE_PORT` | `3005` | Port yang di-expose ke AeroSwarm (bisa via SSH reverse tunnel). |
| `AEROSWARM_AIRPORT_ID` | ICAO bandara, e.g. `WARR` | Scope ingest & history/replay. |
| `AEROSWARM_INGEST_SECRET` | Dashboard → *Connect backend* → kopas dari *env block* | Untuk HTTP/WebSocket; header `x-aero-ingest-secret` atau query `?secret=`. |
| `AEROSWARM_MONITOR_TOKENS` | Dashboard → *Connect backend* → kopas dari *env block* | Comma-separated monitor token (`srctk_...`). |
| `AEROSWARM_INGEST_KAFKA_BROKERS` (opsional) | e.g. `redpanda:9092` | Hanya kalau pakai transport Kafka. |
| `AEROSWARM_INGEST_KAFKA_TOPIC` (opsional) | Dashboard → *Connect backend* | Hanya kalau pakai transport Kafka. |

Langkahnya:

1. Pastikan `connection-service` bisa diakses dari jarak oleh AeroSwarm (mis. `http://<ip-vps>:3005/aero`).
2. Di dashboard AeroSwarm: **Airports → bandara → Backend connection → Connect backend**.
3. Pilih transport dan masukkan base URL `http://<ip-vps>:3005/aero`.
4. Kopas blok env yang muncul ke `.env` di sini, lalu restart `connection-service`.
5. Untuk Kafka, isi juga `ADVERTISED_KAFKA_HOST` (alamat Redpanda yang bisa dijangkau AeroSwarm) dan `AEROSWARM_INGEST_KAFKA_BROKERS`.

## Dokumentasi

- **A-SMGCS Juanda — kebutuhan inti → tugas implementasi**: [docs/asmgcs/000-ringkasan.md](docs/asmgcs/000-ringkasan.md)
  (seri 000–007: lalu lintas, warning function, persistence, NOTAM/ASHTAM, cuaca BMKG,
  record/playback, rules & taxiway lock)
- **Integrasi AeroSwarm (federasi history/replay)**: lihat
  `aeroswarm-project/docs/development/federation/006-connecting-a-backend.md`


docker compose --env-file .env.development -f docker-compose.yml -f docker-compose.local.yml down
docker compose --env-file .env.development -f docker-compose.yml -f docker-compose.local.yml up -d

ssh -fN -o ServerAliveInterval=60 -R 0.0.0.0:13005:localhost:3005 mid@192.168.2.231