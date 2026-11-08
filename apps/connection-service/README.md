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

## Ingest — empat transport, pilih sesuai kebutuhan volume

Keempatnya menulis ke tabel yang sama (`ingest.service.ts`, micro-batch 500ms/500 baris) —
bedanya cuma cara event sampai ke sini. Perbandingan lengkap:
`aeroswarm-project/docs/development/federation/006-*.md`.

| Transport | Path | Auth | Ketahanan saat service ini down |
|---|---|---|---|
| `http` webhook | `POST /aero/ingest` | header `x-aero-ingest-secret` | Gap-free — AeroSwarm retry + DLQ |
| `websocket` | `WS /aero/ingest/ws?secret=...` | query `secret` (ws sink tidak bisa kirim header) | **Drop** event selama disconnect |
| `kafka` (Redpanda) | consumer, bukan endpoint HTTP | jaringan (broker reachability) | Gap-free selama masih dalam retensi topic (default 1 jam — lihat `docker-compose.yml`) |
| `udp` / `tcp` direct ASTERIX | socket UDP lokal, atau koneksi TCP keluar ke radar | jaringan | **Drop** data selama down — UDP fire-and-forget; TCP tersambung ulang tapi tidak memutar ulang yang terlewat |

### Direct ASTERIX feed (UDP dan TCP)

`modules/feed/asterix-feed.ts` menjalankan `AsterixFeedSource` dari `@aeroswarm/ingest`
(decode via `@aeroswarm/codec`) langsung di process ini — tanpa AeroSwarm processing layer.
UDP dan TCP bisa aktif bersamaan; feed yang port-nya kosong tidak dijalankan. Konfigurasi
dibaca `asterix-config.ts` (fungsi murni, dites). Event distamp `airportId` dari
`AEROSWARM_AIRPORT_ID`, lalu masuk ke buffer ingest yang sama dengan jalur HTTP/WS/Kafka.

- **UDP** — listener (unicast atau multicast).
- **TCP** — backend adalah **client**: connect keluar ke radar/gateway dan tersambung ulang
  tiap 5 detik. Mode TCP *server* (backend menerima koneksi masuk) belum didukung.
- Permukaan (CAT010/011) ditandai `onGround = true`, kategori lain `false`. Target test,
  simulated, dan fixed transponder (MLAT RPU) dibuang.

| Variable | Fungsi |
|---|---|
| `AEROSWARM_FEED_UDP_PORT` | Port UDP untuk listen — **kosong = feed UDP nonaktif** |
| `AEROSWARM_FEED_UDP_HOST` | Bind address (default `0.0.0.0`) |
| `AEROSWARM_FEED_SOURCE_ID` | Label sumber feed UDP (default `asterix-udp`) |
| `AEROSWARM_FEED_MULTICAST_GROUP` / `AEROSWARM_FEED_MULTICAST_IFACE` | Join multicast group (contoh `224.0.0.1`) — iface opsional |
| `ASTERIX_TCP_HOST` / `ASTERIX_TCP_PORT` | Alamat radar/gateway untuk feed TCP — **keduanya wajib**, salah satu kosong = TCP nonaktif |
| `ASTERIX_TCP_SOURCE_ID` | Label sumber feed TCP (default `asterix-tcp`) |
| `ASTERIX_ALLOWED_CATS` | Kategori yang di-forward (default `10,11,20,21,48,62`) — CAT23/34/63/19/247 selalu di-skip (service messages, bukan track) |
| `ASTERIX_FORCED_EDITIONS` | Paksa edition per kategori, format `21:2.4,48:1.21` — untuk feed yang edition-nya tidak auto-detect |
| `RADAR_SITE_LAT` / `RADAR_SITE_LON` | Koordinat radar — **wajib untuk CAT048** (posisi polar/Cartesian relatif ke site; tanpa ini record tanpa lat/lon di-skip). Kosong dianggap tidak di-set |
| `ASTERIX_FEEDS` | Array JSON untuk **banyak feed sekaligus** (beberapa UDP, beberapa TCP), jalan tambahan di atas `AEROSWARM_FEED_UDP_PORT` / `ASTERIX_TCP_*`. Lihat di bawah |
| `ASTERIX_RADAR_SITES` | JSON `{"sac:sic":{"lat":..,"lon":..}}` — titik ANTENA per sensor bila satu stream membawa beberapa radar (jaringan multi-radar); menimpa `RADAR_SITE_*`. Satu `RADAR_SITE_*` untuk banyak radar menggeser semua radar lain. Radar tanpa titik tidak muncul di peta: target udara hampir seluruhnya dari CAT048. Hitungannya ada di `unlocated` pada status feed (`feeds`), dan setiap radar dicatat satu kali di log. `bun run radar-sites.ts <pcap>` di `aeroswarm-project/sample/tsrunner` mendaftar radar dan memperkirakan antenanya |

#### Banyak feed (`ASTERIX_FEEDS`)

```json
[
  {"name":"radar-a","transport":"udp","port":30000,"multicastGroup":"224.0.0.1"},
  {"name":"radar-b","transport":"udp","port":30001,"radarSite":{"lat":-7.4,"lon":112.8}},
  {"name":"mlat","transport":"tcp","host":"10.0.0.5","port":2000,"allowedCats":[10,11]}
]
```

Field per feed: `transport` (`udp`/`tcp`, wajib), `port` (angka, wajib), `host` (wajib untuk tcp),
`name`, `sourceId`, `airportId`, `allowedCats` (array atau `"21,48"`), `forcedEditions`
(objek atau `"21:2.4"`), `radarSite`, `radarSites`; khusus UDP: `bindHost`, `multicastGroup`,
`multicastIface`. Yang tidak diisi mewarisi env bersama. `name` harus unik (default
`<transport>-<urutan>`), dan dua UDP tidak boleh berbagi port + `bindHost` (keduanya akan
menerima paket yang sama dan menggandakan track) — entri bermasalah dilewati dengan peringatan.

Nilai tidak valid (port di luar 1–65535, JSON rusak, HOST tanpa PORT) menghasilkan peringatan
di log dan feed itu dilewati — service tetap start.

### AFTN / flight plan

`modules/feed/aftn-feed.ts` menjalankan `AftnFeedSource` (`@aeroswarm/ingest`) langsung dari
gateway AFTN, tanpa AeroSwarm. UDP dan TCP bisa bersamaan, plus `AFTN_FEEDS` untuk banyak
gateway. Setiap pesan yang berhasil diparse:

1. dilipat ke flight plan di memori (`FlightPlanStore`) → `flightPlan.phase` ARRIVAL/DEPARTURE
   ditempel ke track, termasuk yang sudah tampil → warna label kuning/hijau di FE;
2. diterbitkan ke Kafka (`AEROSWARM_FLIGHTPLAN_TOPIC`, default `aeroswarm.flightplan.warr`)
   dengan bentuk `FlightPlanEvent` yang sama seperti dulu, sehingga advisory-service tidak
   berubah dan menyimpannya ke `aftn_messages`.

Saat start, plan dipulihkan dengan memutar ulang event tersimpan (`aftn_messages`, 48 jam
terakhir, urut waktu) — tanpa ini semua label putih sampai AFTN berikutnya masuk. Bila DB belum
siap, service tetap start dengan peringatan. AFTN yang kebetulan ikut di stream ASTERIX (satu
forwarder) memakai jalur yang sama.

| Variable | Fungsi |
|---|---|
| `AFTN_FEED_UDP_PORT` | Port UDP, satu pesan per datagram. Kosong = nonaktif. Selalu listen di `0.0.0.0` |
| `AFTN_FEED_SOURCE_ID` / `_MULTICAST_GROUP` / `_MULTICAST_IFACE` | Label sumber (default `aftn-udp`) dan multicast |
| `AFTN_TCP_HOST` / `AFTN_TCP_PORT` | Gateway AFTN untuk feed TCP (backend = client, reconnect 5 dtk). Keduanya wajib |
| `AFTN_TCP_SOURCE_ID` | Label sumber TCP (default `aftn-tcp`) |
| `AFTN_FEEDS` | Array JSON banyak feed: `{name, transport, port, host?, sourceId?, airportId?, multicastGroup?, multicastIface?}` |
| `AFTN_KAFKA_BROKERS` | Broker tujuan; kosong → `AEROSWARM_TRACK_KAFKA_BROKERS` → `KAFKA_BROKERS`. Semua kosong = AFTN hanya di memori |
| `AEROSWARM_FLIGHTPLAN_TOPIC` | Topic tujuan (harus sama dengan yang dibaca advisory-service) |

Selama AeroSwarm masih hidup dan menulis ke topic yang sama, pesan akan tersimpan ganda:
pakai topic berbeda selama jalan paralel.

## Live WebSocket

`WS /ws/tracks/live?token=<CONNECTION_API_TOKENS>` — kontrak sama dengan `/ws/tracks/live`
milik AeroSwarm, sehingga `@aeroswarm/client` (`tracks.subscribe`, `reconnect()`) tersambung
tanpa perubahan; FE cukup mengganti `VITE_AEROSWARM_ENDPOINT`. Protokol dan semantik
lengkap: README `@aeroswarm/live-server`.

Alur: feed ASTERIX → `TrackState` (stale/lost/removed, de-duplikasi `icao24`, flight plan) →
semua klien yang subscribe. AFTN dari feed → `FlightPlanStore` → `flightPlan.phase`
(ARRIVAL/DEPARTURE) ditempel ke track, termasuk track yang sudah tampil di layar. Status
ground station (CAT23) diteruskan sebagai `source.status`.

- Tanpa token ditutup `4001`, token salah `4003`. Koneksi dikunci ke `AEROSWARM_AIRPORT_ID`.
- State ada di memori satu proses: jalankan **satu instance**.
- Jalur live tidak bergantung pada database; DB yang mati hanya menghentikan penyimpanan.
- Pengaturan: `STALE_AFTER_MS`, `LOST_AFTER_MS`, `TRACK_REMOVE_AFTER_MS`, `TRACK_SWEEP_MS`,
  `WS_DEFAULT_UPDATE_HZ`, `WS_HEARTBEAT_MS`, `INTEREST_BBOX` (digantikan oleh `interestRadiusNm` pada aturan `ALERT_AREA` bila diisi, dibaca tiap menit tanpa restart; butuh `@aeroswarm/live-server` yang punya `setInterest`), `INTEREST_LOOKAHEAD_MIN`
  (lihat `.env.example`). Nilai tidak valid memberi peringatan dan memakai default.

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
| `WS` | `/ws/tracks/live?token=...` | query token | Live track stream (lihat bagian Live WebSocket) |
| `WS` | `/aero/replay?token=<monitor token>` | query token | Server-paced replay (protokol `replay.start/pause/resume/seek/stop`) |
| `GET` | `/health`, `/metrics` | — | Health check & Prometheus |

## Environment

| Variable | Fungsi |
|---|---|
| `CONNECTION_SERVICE_PORT` | Port listen (default 3005) |
| `DATABASE_URL` | Postgres dbudara (tabel `aeroswarm_*` sudah ada di schema `public`) |
| `AEROSWARM_INGEST_SECRET` | Shared secret ingest http+ws — samakan dengan `config.headers["x-aero-ingest-secret"]` (http) atau `?secret=` (websocket) pada connector di AeroSwarm |
| `CONNECTION_API_TOKENS` | Comma-separated token akses untuk **live WebSocket dan replay/history** (`/ws/tracks/live`, `/aero/*`). Beberapa token boleh aktif bersamaan untuk rotasi. Kosong = semua koneksi ditolak. Buat dengan `openssl rand -hex 24` |
| `AEROSWARM_MONITOR_TOKENS` | Nama lama (token `srctk_...` dari AeroSwarm). Masih dibaca dan digabung dengan `CONNECTION_API_TOKENS` |
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

## Penelusuran pesawat: `GET /aero/trace`

"Kenapa pesawat X ada di FlightRadar24 tetapi tidak di peta?" tidak bisa dijawab dari statistik, karena pembuangan terjadi diam-diam di beberapa tahap. Endpoint ini menunjukkan di tahap mana sebuah pesawat terakhir terlihat atau dibuang.

```
GET /aero/trace?q=CTV718&token=<token>      (atau header Authorization: Bearer <token>)
```

`q` = callsign (sebagian pun boleh), ICAO24, atau trackId; token yang sama dengan jejak (`/aero/tracks/:id/trail`). Jawabannya memuat, per pesawat yang cocok, `verdict` (kesimpulan satu kalimat) dan `entries`: peralihan di tiap tahap, dengan sensor (`asterix-cat048 50:26`), posisi, ketinggian, hitungan, dan umurnya.

| Tahap | Hasil | Artinya |
|---|---|---|
| `ingest` | `diterima` | sebuah sensor melaporkannya dan laporannya punya posisi dan identitas |
| `ingest` | `dibuang: no-position` | laporan tanpa posisi; untuk radar CAT048 berarti antenanya belum punya koordinat (`ASTERIX_RADAR_SITES`) |
| `ingest` | `dibuang: no-identity` / `test-target` | tanpa alamat Mode-S dan nomor track, atau ditandai target uji, simulasi, atau transponder referensi |
| `fusi` | `dipakai` / `ditahan` | fusi memakainya, atau sensor lain yang sedang ditampilkan |
| `gambaran-udara` | `tampil (status)` | sampai ke gambaran udara yang dikirim ke klien |
| `gambaran-udara` | `tidak masuk`, `dihapus: exited/filtered/superseded` | ditolak atau dihapus oleh area cakupan surveilans (`INTEREST_BBOX` atau `interestRadiusNm`) atau digantikan track lain |

Jawaban kosong (`matches: []`) berarti pesawat itu tidak pernah sampai ke layanan ini sejak ia mulai: feed tidak membawanya, atau laporannya dibuang sebelum identitasnya tercatat. Catatan ini hanya di memori (30 peralihan per pesawat, 5000 pesawat) dan hilang saat layanan restart. Catatan tahap `ingest` yang dibuang butuh `@aeroswarm/ingest` yang punya `onDrop`; tanpa itu hanya tahap yang diterima yang tercatat.

## Jalur relay ke gambaran udara (`RELAY_TO_LIVE`)

Ada dua jalur masuk track: feed ASTERIX langsung (didecode di sini) dan relay (topic Kafka AeroSwarm `AEROSWARM_INGEST_KAFKA_TOPIC`, WebSocket `/aero/ingest/ws`). Keduanya disimpan ke database dan dikirim ke `alert-service` lewat Kafka (`asmgcs.tracks`). Gambaran udara yang dikirim ke peta (`/ws/tracks/live`) dulu **hanya** diisi feed langsung, jadi pesawat yang hanya datang lewat relay terlihat oleh layanan alert (segmen aerodrome terisi, alert terpicu) tetapi tidak ada di peta.

Sekarang track relay yang lolos penyaring kembar (`primary-feed-gate`: pesawat yang baru dilihat feed langsung dalam `INGEST_DEDUPE_WINDOW_MS` dibuang) juga diteruskan ke gambaran udara, lewat normalisasi dan fusi yang sama dengan feed langsung (satu pesawat tetap satu track berdasarkan alamat Mode-S). `RELAY_TO_LIVE=false` mematikannya. Endpoint `GET /aero/trace` menandai track ini dengan `diterima (relay)`. Rute HTTP `POST /aero/ingest` belum meneruskan ke gambaran udara.
