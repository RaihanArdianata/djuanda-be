# connection-service

Menghubungkan backend ini ke AeroSwarm untuk data surveillance bandara (WARR):

1. **Ingest** — menerima fused track & alert dari AeroSwarm (via `http` connector yang
   didaftarkan di dashboard AeroSwarm) dan menyimpannya ke tabel `aeroswarm_tracks` /
   `aeroswarm_alerts` milik database ini sendiri.
2. **Replay/history** — menyajikan histori itu kembali lewat protokol replay standar AeroSwarm
   (`@aeroswarm/replay-server`), sehingga dashboard/SDK AeroSwarm bisa replay langsung ke
   service ini (client-side federation — set `history_endpoint` bandara di dashboard AeroSwarm
   ke `http://<host>:3005/aero`).

Port default surveillance: `18086` (`HTTP_PORT`). Diakses **langsung** (bukan lewat gateway):
AeroSwarm POST ingest ke sini, dan browser dashboard connect ke sini untuk replay — karena itu
CORS ditangani di service ini sendiri.

## Ingest — empat transport, pilih sesuai kebutuhan volume

Keempatnya menulis ke tabel yang sama (`ingest.service.ts`, micro-batch 500ms/500 baris) —
bedanya cuma cara event sampai ke sini. Perbandingan lengkap:
`aeroswarm-project/docs/development/federation/006-*.md`.

| Transport | Path | Auth | Ketahanan saat service ini down |
|---|---|---|---|
| `http` webhook | `POST /aero/ingest` | header `x-aero-ingest-secret` | Gap-free — AeroSwarm retry + DLQ |
| `websocket` | `WS /aero/ingest/ws?secret=...` | query `secret` (ws sink tidak bisa kirim header) | **Drop** event selama disconnect |
| `kafka` (Redpanda) | consumer, bukan endpoint HTTP | jaringan (broker reachability) | Gap-free selama masih dalam retensi topic (default 1 jam — lihat `docker-compose.yml`) |
| `udp` direct ASTERIX | socket UDP lokal, bukan endpoint HTTP | jaringan (siapa pun yang bisa kirim ke port) | **Drop** datagram selama down — UDP memang fire-and-forget |

### UDP direct ASTERIX feed

The surveillance deployment also accepts the R&D configuration names:

| Variable | Default | Function |
|---|---:|---|
| `SOURCE_TRANSPORT` | `udp` | Source transport |
| `SOURCE_BIND_HOST` | `0.0.0.0` | UDP bind address |
| `SOURCE_PORT` | `2026` | ASTERIX/mixed UDP port |
| `SOURCE_ID` | `radar-main` | Source identity |
| `AIRPORT_ID` | empty | Airport scope |
| `AFTN_ENABLED` | `false` | Enable dedicated AFTN input |
| `AFTN_PORT` | `2028` | Dedicated AFTN UDP port |
| `AFTN_SOURCE_ID` | `aftn` | AFTN source identity |
| `HTTP_HOST` / `HTTP_PORT` | `0.0.0.0` / `18086` | HTTP and WebSocket listener |
| `AERO_TOKEN` | empty | Live/replay token; never log it |

`@aeroswarm/ingest` handles ASTERIX through `@aeroswarm/codec`, detects AFTN
messages on a mixed source when ASTERIX decoding yields no record, and emits
CAT023 source-health events separately. CAT020 is treated as MLAT by the
deployment documentation; the decoder's original category/protocol metadata is
preserved in the event.

The live endpoint is:

```text
ws://<host>:18086/ws/tracks/live?token=<AERO_TOKEN>
```

Send the standard message:

```json
{"type":"subscribe","airportId":"WARR","maxUpdateHz":10}
```

Replay remains available under `/aero/replay/days`, `/aero/replay/range`, and
`/aero/tracks/:trackId/history` with the configured monitor token.

### Optional output connectors

Outbound connectors are disabled unless configured. The service accepts:

```env
AEROSWARM_OUTPUT_WEBHOOK_URL=
AEROSWARM_OUTPUT_WEBHOOK_SECRET=
AEROSWARM_OUTPUT_KAFKA_BROKERS=redpanda:9092
AEROSWARM_OUTPUT_KAFKA_TOPIC=aeroswarm.surveillance
AEROSWARM_OUTPUT_WEBSOCKET_URL=
```

Connector failures are logged without secrets, counted, and do not stop UDP
ingest. Shutdown flushes and closes configured connectors.

### Surveillance metrics

The `/metrics` endpoint includes the surveillance counters
`asterix_packets_received_total`, `asterix_packets_undecoded_total`,
`asterix_tracks_decoded_total`, `asterix_tracks_persisted_total`,
`aftn_messages_received_total`, `aftn_flightplans_persisted_total`,
`source_health_events_total`, `websocket_clients`,
`websocket_messages_sent_total`, `websocket_updates_dropped_total`,
`db_write_errors_total`, and `connector_send_errors_total`.

`udp-feed.ts` men-decode datagram ASTERIX langsung di process ini via `@aeroswarm/codec`
(tanpa AeroSwarm processing layer) — berguna saat backend ini menerima feed radar/MLAT
langsung dari sensor, bukan dari AeroSwarm. Nonaktif default; aktif dengan
`AEROSWARM_FEED_UDP_PORT`. Event distamp `airportId` dari `AEROSWARM_AIRPORT_ID`.

| Variable | Fungsi |
|---|---|
| `AEROSWARM_FEED_UDP_PORT` | Port UDP untuk listen datagram ASTERIX — **kosong = feed nonaktif** |
| `AEROSWARM_FEED_UDP_HOST` | Bind address (default `0.0.0.0`) |
| `AEROSWARM_FEED_SOURCE_ID` | Label sumber di event (default `asterix-udp`) |
| `ASTERIX_ALLOWED_CATS` | Kategori yang di-forward (default `10,11,20,21,48,62`) — CAT23/34/63/19/247 selalu di-skip (service messages, bukan track) |
| `ASTERIX_FORCED_EDITIONS` | Paksa edition per kategori, format `21:2.4,48:1.21` — untuk feed yang edition-nya tidak auto-detect |
| `RADAR_SITE_LAT` / `RADAR_SITE_LON` | Koordinat radar — **wajib untuk CAT048** (posisi Cartesian/polar relatif ke site; tanpa ini record CAT048 di-skip) |
| `AEROSWARM_FEED_MULTICAST_GROUP` / `AEROSWARM_FEED_MULTICAST_IFACE` | Join multicast group (contoh feed radar `224.0.0.1`) — iface opsional |

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

`@aeroswarm/codec` dan `@aeroswarm/replay-server` diambil dari npmjs publik (org
`aeroswarm`) — tidak ada scope redirect di `.npmrc`, resolve seperti package biasa.
