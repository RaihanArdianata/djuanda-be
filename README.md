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
docker compose up -d
```

Pastikan `postgres`, `pgbouncer`, `redis`, dan `redpanda` healthy:

```powershell
docker compose ps
```

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

## Dokumentasi

- **A-SMGCS Juanda — kebutuhan inti → tugas implementasi**: [docs/asmgcs/000-ringkasan.md](docs/asmgcs/000-ringkasan.md)
  (seri 000–007: lalu lintas, warning function, persistence, NOTAM/ASHTAM, cuaca BMKG,
  record/playback, rules & taxiway lock)
- **Integrasi AeroSwarm (federasi history/replay)**: lihat
  `aeroswarm-project/docs/development/federation/` (khususnya 004 untuk sisi repo ini)
