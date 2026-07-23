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

## Ingest — tiga transport, pilih sesuai kebutuhan volume

Ketiganya menulis ke tabel yang sama (`ingest.service.ts`, micro-batch 500ms/500 baris) —
bedanya cuma cara event sampai ke sini. Perbandingan lengkap:
`aeroswarm-project/docs/development/federation/006-*.md`.

| Transport | Path | Auth | Ketahanan saat service ini down |
|---|---|---|---|
| `http` webhook | `POST /aero/ingest` | header `x-aero-ingest-secret` | Gap-free — AeroSwarm retry + DLQ |
| `websocket` | `WS /aero/ingest/ws?secret=...` | query `secret` (ws sink tidak bisa kirim header) | **Drop** event selama disconnect |
| `kafka` (Redpanda) | consumer, bukan endpoint HTTP | jaringan (broker reachability) | Gap-free selama masih dalam retensi topic (default 1 jam — lihat `docker-compose.yml`) |

## Endpoint HTTP/WS

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| `POST` | `/aero/ingest` | header `x-aero-ingest-secret` | Terima satu event (`{ event, timestamp }`) dari webhook connector AeroSwarm |
| `WS` | `/aero/ingest/ws?secret=...` | query `secret` | Terima event (bare JSON, satu per frame) dari websocket connector AeroSwarm |
| `GET` | `/aero/replay/days` | `Authorization: Bearer <monitor token>` | Kalender ketersediaan data |
| `GET` | `/aero/replay/range` | Bearer | Ringkasan satu rentang waktu |
| `GET` | `/aero/tracks/:trackId/history` | Bearer | Riwayat posisi satu track |
| `GET` | `/aero/alerts` | Bearer | Histori alert |
| `GET` | `/aero/warnings/status?windowS=` | Bearer | Status panel Warning Function A-SMGCS (agregat dari `alerts()`) |
| `WS` | `/aero/replay?token=<monitor token>` | query token | Server-paced replay (protokol `replay.start/pause/resume/seek/stop`) |
| `GET` | `/health`, `/metrics` | — | Health check & Prometheus |

## Environment

| Variable | Fungsi |
|---|---|
| `CONNECTION_SERVICE_PORT` | Port listen (default 3005) |
| `DATABASE_URL` | Postgres dbudara (tabel `aeroswarm_*` sudah ada di schema `public`) |
| `AEROSWARM_INGEST_SECRET` | Shared secret ingest http+ws — samakan dengan `config.headers["x-aero-ingest-secret"]` (http) atau `?secret=` (websocket) pada connector di AeroSwarm |
| `AEROSWARM_MONITOR_TOKENS` | Comma-separated monitor token (`srctk_...`) yang di-mint AeroSwarm saat create connector — kredensial baca untuk `/aero/*` |
| `AEROSWARM_INGEST_KAFKA_BROKERS` | `host:port` broker Redpanda, comma-separated. **Kosong = consumer Kafka nonaktif** — http/ws tetap jalan tanpa ini |
| `AEROSWARM_INGEST_KAFKA_TOPIC` | Topic yang di-consume (default `aeroswarm.ingest.warr`) |
| `AEROSWARM_INGEST_KAFKA_GROUP_ID` | Consumer group id (default `connection-service`) |

> `ADVERTISED_KAFKA_HOST` **bukan** env service ini — itu env untuk service `redpanda` di
> root `docker-compose.yml`, dipakai broker untuk memberi tahu klien luar (AeroSwarm) alamat
> mana yang harus dihubungi. Isi dengan IP VPS ini yang bisa dijangkau AeroSwarm (LAN atau
> publik, bukan `localhost`) — cek dengan `hostname -I` di VPS ini, verifikasi dari sisi
> AeroSwarm dengan `nc -zv <IP> 19092`.

## Setup di sisi AeroSwarm

**Cara cepat**: dashboard AeroSwarm → tab Airports → tombol "Connect backend" pada baris WARR
→ isi base URL (`http://<host-ini>:3005`) + pilih transport (`http`/`websocket`) → satu kali
submit membuat connector, mint monitor token, dan set history endpoint sekaligus, plus
menampilkan blok `.env` siap tempel. Detail: `aeroswarm-project/docs/development/federation/
006-*.md`.

**Manual** (wajib untuk `kafka` — belum ada di wizard):
1. Dashboard AeroSwarm → Connectors → Add Connector:
   - `http`: type `http`, config `{ "url": "http://<host-ini>:3005/aero/ingest", "headers": { "x-aero-ingest-secret": "<AEROSWARM_INGEST_SECRET>" } }`
   - `websocket`: type `websocket`, config `{ "url": "ws://<host-ini>:3005/aero/ingest/ws?secret=<AEROSWARM_INGEST_SECRET>" }`
   - `kafka`: type `kafka`, config `{ "brokers": ["<ADVERTISED_KAFKA_HOST>:19092"], "topic": "<AEROSWARM_INGEST_KAFKA_TOPIC>" }`
   - Filter: `{ "airportId": "WARR" }` di ketiganya — ini yang men-trigger mint monitor token.
2. Simpan `monitorToken` yang muncul sekali → masukkan ke `AEROSWARM_MONITOR_TOKENS` di sini.
3. Dashboard AeroSwarm → Airports → WARR → History endpoint: `http://<host-ini>:3005/aero`.

## Catatan dependency

`@aeroswarm/replay-server` diambil dari registry Verdaccio LAN kantor
(`http://192.168.2.237:4873/`) — lihat `.npmrc` root repo (`@aeroswarm:registry=...`).
Kalau build dijalankan dari luar LAN itu (mis. VPS di internet publik yang tidak bisa hairpin
ke IP LAN), fallback tervendorkan tersedia — lihat komentar di root `Dockerfile`.
