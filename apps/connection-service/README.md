# connection-service

Menghubungkan backend ini ke AeroSwarm untuk data surveillance bandara (WARR):

1. **Ingest** — menerima fused track & alert dari AeroSwarm (via `http` connector yang
   didaftarkan di dashboard AeroSwarm) dan menyimpannya ke tabel `aeroswarm_tracks` /
   `aeroswarm_alerts` milik database ini sendiri.
2. **Replay/history** — menyajikan histori itu kembali lewat protokol replay standar AeroSwarm
   (`@aeroswarm/replay-server`), sehingga dashboard/SDK AeroSwarm bisa replay langsung ke
   service ini (client-side federation — set `history_endpoint` bandara di dashboard AeroSwarm
   ke `http://<host>:3005/aero`).

Port default: `3005` (`CONNECTION_SERVICE_PORT`). Diakses **langsung** (bukan lewat gateway):
AeroSwarm POST ingest ke sini, dan browser dashboard connect ke sini untuk replay — karena itu
CORS ditangani di service ini sendiri.

## Endpoint

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| `POST` | `/aero/ingest` | header `x-aero-ingest-secret` | Terima satu event (`{ event, timestamp }`) dari webhook connector AeroSwarm |
| `GET` | `/aero/replay/days` | `Authorization: Bearer <monitor token>` | Kalender ketersediaan data |
| `GET` | `/aero/replay/range` | Bearer | Ringkasan satu rentang waktu |
| `GET` | `/aero/tracks/:trackId/history` | Bearer | Riwayat posisi satu track |
| `GET` | `/aero/alerts` | Bearer | Histori alert |
| `WS` | `/aero/replay?token=<monitor token>` | query token | Server-paced replay (protokol `replay.start/pause/resume/seek/stop`) |
| `GET` | `/health`, `/metrics` | — | Health check & Prometheus |

## Environment

| Variable | Fungsi |
|---|---|
| `CONNECTION_SERVICE_PORT` | Port listen (default 3005) |
| `DATABASE_URL` | Postgres dbudara (tabel `aeroswarm_*` sudah ada di schema `public`) |
| `AEROSWARM_INGEST_SECRET` | Shared secret ingest — samakan dengan `config.headers["x-aero-ingest-secret"]` pada http connector di AeroSwarm |
| `AEROSWARM_MONITOR_TOKENS` | Comma-separated monitor token (`srctk_...`) yang di-mint AeroSwarm saat create connector — kredensial baca untuk `/aero/*` |

## Setup di sisi AeroSwarm

1. Dashboard AeroSwarm → Connectors → Add Connector: type `http`, airport `WARR`, config
   `{ "url": "http://<host-ini>:3005/aero/ingest", "headers": { "x-aero-ingest-secret": "<AEROSWARM_INGEST_SECRET>" } }`,
   filter topics `aero.fused.track.v1` — dan satu lagi untuk `aero.alert.v1`.
2. Simpan `monitorToken` yang muncul sekali → masukkan ke `AEROSWARM_MONITOR_TOKENS` di sini.
3. Dashboard AeroSwarm → Airports → WARR → History endpoint: `http://<host-ini>:3005/aero`.

## Catatan dependency

`@aeroswarm/replay-server` diambil dari registry privat `https://registry.midigi.id/`.
Pastikan `.npmrc` sudah dikonfigurasi dengan `@aeroswarm:registry=https://registry.midigi.id/`.
