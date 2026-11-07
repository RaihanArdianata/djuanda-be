# alert-service — Panduan Alert / Deteksi

## Alert apa saja yang sudah diseeding?

Di `packages/database/seed-alert-rules.ts` sudah disiapkan 5 aturan aktif untuk bandara `WARR`:

| Tipe Alert | Severity | Keterangan singkat |
|------------|----------|-------------------|
| `STCA` | HIGH | Short Term Conflict Alert: 2 track terlalu dekat prediksi 60 detik. |
| `RUNWAY_INCURSION` | CRITICAL | Track masuk ke polygon runway yang sedang `active`. |
| `TAXIWAY_APRON_INCURSION` | WARNING | Track di luar expected route atau masuk polygon taxiway/apron. |
| `AREA_PENETRATION` | WARNING | Track masuk restricted area. |
| `DEVIATION` | WARNING | Track menyimpang dari expected route (horizontal, altitude, waktu). |

## Arti Alert dalam Bahasa Simpel

| Tipe Alert | Arti Sederhana |
|------------|----------------|
| `STCA` | Dua objek (pesawat/kendaraan) diprediksi bakal terlalu dekat dalam waktu singkat. Intinya: hampir tabrakan. |
| `RUNWAY_INCURSION` | Ada pesawat atau kendaraan yang masuk ke landasan pacu (runway) yang sedang dipakai. Berbahaya karena bisa nabrak pesawat yang akan lepas landas/mendarat. |
| `TAXIWAY_APRON_INCURSION` | Kendaraan/pesawat masuk ke jalan taxi atau area apron yang bukan jalurnya, atau keluar dari rute yang sudah ditentukan. |
| `AREA_PENETRATION` | Ada objek yang masuk ke area terlarang/terbatas di bandara, seperti zona kritis atau zona keamanan. |
| `DEVIATION` | Pesawat tidak mengikuti rute yang sudah dijanjikan, baik jalur, ketinggian, atau waktunya menyimpang dari rencana. |

## Data apa saja yang dipakai?

| Sumber Data | Dari Mana | Dipakai Oleh Alert |
|-------------|-----------|-------------------|
| **Surveillance tracks** | Kafka topic `asmgcs.tracks` via `track.consumer.ts` | Semua alert (posisi, altitude, speed, heading, callsign, dsb). |
| **Aerodrome features** | HTTP `aerodrome-service` di `http://aerodrome-service:3006/features` | `RUNWAY_INCURSION`, `TAXIWAY_APRON_INCURSION`, `AREA_PENETRATION`. |
| **Weather (METAR/TAF)** | HTTP `weather-service` | Saat ini hanya context, tidak langsung memicu alert di aturan bawaan. |
| **AFTN (FPL)** | HTTP `advisory-service` di `http://advisory-service:3007/aftn?destination=WARR&messageType=FPL` | `DEVIATION` — membutuhkan `expectedRoute`. |

## Property / field apa saja yang relevan?

### 1. Surveillance track (`MovementTrack`)

| Field | Tipe | Dipakai untuk |
|-------|------|---------------|
| `trackId` | string | ID unik track |
| `airportId` | string | Filter bandara, misal `WARR` |
| `latitude`, `longitude` | number | Semua alert lokasi |
| `altitude` | number? | `STCA`, `DEVIATION` |
| `groundSpeed` | number? | Prediksi posisi di `STCA` |
| `heading` | number? | Prediksi posisi di `STCA` |
| `timestamp` | Date | `DEVIATION` (waktu), context waktu |
| `callsign`, `registration`, `aircraftType` | string? | Context/identifikasi |
| `targetType` | string | `AIRCRAFT`/`VEHICLE`/lainnya |

### 2. Aerodrome features

| Layer | Property penting | Dipakai |
|-------|------------------|---------|
| `RUNWAY` | `active: true` atau `status: "ACTIVE"` | `RUNWAY_INCURSION` |
| `TAXIWAY` / `APRON` | polygon | `TAXIWAY_APRON_INCURSION` |
| `RESTRICTED` atau `properties.restricted: true` | `type` | `AREA_PENETRATION` |

### 3. AFTN FPL

| Field | Dipakai |
|-------|---------|
| `callSign` | Group by callsign |
| `parsed.route` / `parsed.expectedRoute` | `DEVIATION` (wajib ada) |
| `parsed.expectedRouteTimes` | `DEVIATION` (optional, untuk time check) |

## Apa saja yang sudah bisa jalan vs yang belum?

Berdasarkan data yang sudah ada:

| Alert | Bisa jalan jika... | Status saat ini |
|-------|--------------------|-----------------|
| **STCA** | Ada ≥ 2 track aktif dalam radius WARR | Bisa, asal `alert-service` terhubung Kafka `asmgcs.tracks`. |
| **RUNWAY_INCURSION** | Data runway dengan polygon dan `active=true` ada di `aerodrome-service` | Bisa, tergantung data aerodrome. |
| **TAXIWAY_APRON_INCURSION** | Data taxiway/apron polygon ada | Bisa, tergantung data aerodrome. |
| **AREA_PENETRATION** | Restricted area polygon ada | Bisa, tergantung data aerodrome. |
| **DEVIATION** | AFTN FPL tersedia dan punya `expectedRoute` di `parsed` | **Belum** kalau AFTN belum mengandung `expectedRoute`. |

## Bagaimana alert ter-trigger?

### Jalur otomatis (normal)

1. `alert-service` subscribe Kafka topic `asmgcs.tracks` (dikonfigurasi via `ALERT_KAFKA_BROKERS`).
2. Setiap pesan `TRACK_UPDATED` diproses oleh `track.consumer.ts`.
3. `trackUpdated()` menyimpan track ke Redis.
4. `processTrackUpdate()` mengambil semua track untuk `airportId`, lalu mengevaluasi setiap aturan aktif di DB.
5. Kalau terpenuhi, alert disimpan ke DB dan event `ALERT_CREATED` dipublish ke Kafka topic `asmgcs.alerts`.

### Service yang harus hidup

- `redpanda` (Kafka)
- `alert-service` dengan `ALERT_KAFKA_BROKERS=redpanda:9092` di dalam container
- `aerodrome-service` (untuk data aerodrome)
- `advisory-service` (untuk AFTN)
- `connection-service` atau sumber lain yang produce `asmgcs.tracks`

### Cara manual trigger (untuk test)

Kirim pesan `TRACK_UPDATED` ke Kafka:

```bash
# pakai kafkacat / kcat
kafkacat -b redpanda:9092 -t asmgcs.tracks -P <<'EOF'
{
  "eventType": "TRACK_UPDATED",
  "timestamp": "2026-05-30T12:00:00.000Z",
  "data": {
    "trackId": "TEST-001",
    "airportId": "WARR",
    "targetType": "AIRCRAFT",
    "latitude": -7.0,
    "longitude": 112.0,
    "altitudeFt": 100,
    "groundSpeedKt": 0,
    "heading": 90,
    "onGround": true,
    "callsign": "TEST01"
  }
}
EOF
```

> Ganti `latitude`/`longitude` sesuai polygon runway/restricted/taxiway yang mau diuji.

## Environment variables penting

| Env Var | Default | Fungsi |
|---------|---------|--------|
| `ALERT_KAFKA_BROKERS` | `localhost:19092` | Broker Kafka untuk alert-service. Di Docker harus `redpanda:9092`. |
| `ALERT_KAFKA_TRACK_TOPIC` | `asmgcs.tracks` | Topic input surveillance track |
| `ALERT_KAFKA_ALERT_TOPIC` | `asmgcs.alerts` | Topic output alert events |
| `ALERT_KAFKA_ADVISORY_TOPIC` | `asmgcs.advisory` | Update AFTN context |
| `ALERT_KAFKA_WEATHER_TOPIC` | `asmgcs.weather` | Update weather context |
| `ALERT_KAFKA_AERODROME_TOPIC` | `asmgcs.aerodrome` | Update aerodrome context |
| `ALERT_KAFKA_CONSUMER_GROUP` | `asmgcs-alert-service` | Consumer group Kafka |

## Konfigurasi aturan (alert_rules)

Setiap aturan di tabel `alert_rules` memiliki kolom `configuration` JSON. Contoh default yang diseed:

### STCA

```json
{
  "predictionTimeSeconds": 60,
  "minimumHorizontalSeparationNm": 3
}
```

- `predictionTimeSeconds`: berapa detik ke depan posisi diprediksi.
- `minimumHorizontalSeparationNm`: jarak horizontal minimum (nautical miles) sebelum dianggap konflik.
- `minimumVerticalSeparationFt`: selisih tinggi minimum (ft); dua pesawat yang selisihnya sama atau lebih tidak dianggap konflik. Bawaan 1000 bila tidak diisi; `0` atau `null` mematikan pemeriksaan vertikal.
- `requireAltitude`: bawaan `true`; track yang tidak melaporkan ketinggian (banyak track radar) tidak ikut STCA. `false` mengembalikan perilaku lama (hanya jarak horizontal).
- `includeSurface`: bawaan `false`. `true` menyalakan **STCA darat**, dinilai terpisah dari STCA udara (alert-nya membawa `data.domain` = `AIR` atau `SURFACE`): dua target di darat, dengan `surfaceMinimumSeparationMeters` (bawaan 50 m) dan `surfacePredictionTimeSeconds` (bawaan 10 detik). Pasangan campuran udara-darat tidak dinilai (urusan aturan incursion).

### ALERT_AREA

Bukan pendeteksi: aturan konfigurasi **area alert bandara**. Alert hanya berlaku untuk target di dalam area; target di luar tidak ikut aturan apa pun (STCA, incursion, deviasi). Dua zona dari satu titik pusat (ARP):

```json
{
  "centerLatitude": -7.3797,
  "centerLongitude": 112.7868,
  "groundRadiusM": 5000,
  "airRadiusNm": 15
}
```

- `groundRadiusM` (bawaan 5000): radius area darat, untuk target di darat.
- `airRadiusNm` (bawaan 15): radius area udara, untuk pesawat di udara.
- `airCeilingFt` (bawaan di seed 10000; kosong = tanpa batas tinggi): tinggi **kubah** area udara di atas pusat. Area udara berbentuk setengah elipsoid: setinggi plafon di atas pusat dan mengecil ke tepi radius, jadi pesawat yang tinggi di dekat pusat maupun yang rendah di tepi bisa sama-sama di dalam atau di luar menurut posisinya. Pesawat di atas kubah tidak ikut aturan alert. Ketinggian yang tidak dilaporkan dihitung 0 ft.
- `interestRadiusNm` (bawaan di seed 20): radius **area peminat track** di `connection-service`; kotak di sekeliling pusat tempat gambaran udara disimpan (menggantikan `INTEREST_BBOX` bila diisi, berlaku tanpa restart). Harus lebih besar dari `airRadiusNm`.
- Pusat dari `centerLatitude` / `centerLongitude`, atau dari env `ALERT_AREA_CENTER="lat,lon"` bila kosong. Tanpa pusat tidak ada batas area. Menonaktifkan aturan ini juga mematikan batas area.
- Untuk aturan yang belum ada di database, isi tanpa menyentuh aturan lain: `SEED_RULE_TYPES=ALERT_AREA bun run --cwd packages/database seed:alerts` (seed penuh menimpa konfigurasi aturan yang tidak ditandai `preserveConfiguration`). Tanpa aturan, `ALERT_AREA_CENTER` saja sudah cukup untuk menyalakan batas area dengan radius bawaan.
- Jumlah target yang dikeluarkan dihitung di metrik `alert_tracks_outside_area_total`. Alert cuaca tidak terpengaruh.

### ALERT_ENGINE

Bukan pendeteksi: penyetelan engine alert yang bisa diubah operator tanpa restart. Env yang sama menjadi nilai awal, isian aturan menggantikannya, dan yang dikosongkan kembali ke env.

```json
{
  "twinRadiusM": 60,
  "twinMaxSpeedDiffKt": 15,
  "staleGraceSeconds": 20,
  "occupancyStickyMs": 5000
}
```

- `twinRadiusM` (`ALERT_TWIN_RADIUS_M`): track tanpa nama sedekat ini dengan track bernama dianggap pesawat yang sama; 0 mematikan penilaian dari posisi.
- `twinMaxSpeedDiffKt` (`ALERT_TWIN_MAX_SPEED_DIFF_KT`): selisih kecepatan paling besar untuk itu.
- `staleGraceSeconds` (`ALERT_STALE_GRACE_SECONDS`): masa tenggang sebelum alert yang kandidatnya hilang dibersihkan.
- `occupancyStickyMs` (`ALERT_OCCUPANCY_STICKY_MS`): lama runway/taxiway tetap terisi setelah target terakhir terlihat.

### RUNWAY_INCURSION

```json
{
  "active": true
}
```

- Menggunakan data runway dari `aerodrome` context.

### TAXIWAY_APRON_INCURSION

```json
{
  "maxDistanceMeters": 50
}
```

- Kalau `expectedRoute` disediakan, alert trigger jika track off-route lebih dari `maxDistanceMeters`.
- Tanpa `expectedRoute`, trigger jika track masuk polygon taxiway/apron.

### AREA_PENETRATION

```json
{}
```

- Tidak butuh konfigurasi khusus, mengandalkan polygon restricted area dari aerodrome.

### DEVIATION

```json
{
  "maxDistanceMeters": 500,
  "maxAltitudeDeviationFt": 300,
  "expectedRoute": [[lat1, lon1], [lat2, lon2], ...],
  "expectedRouteTimes": ["2026-05-30T12:00:00Z", ...],
  "maximumTimeDeviation": 60
}
```

- `expectedRoute`: polyline yang harusnya dilewati track.
- `expectedRouteTimes`: waktu ideal di tiap titik route.
- `maximumTimeDeviation`: toleransi keterlambatan (detik).

## Cara seed rule ke database

```bash
cd packages/database
bun run seed:alerts
```

Atau dengan env airport custom:

```bash
AEROSWARM_AIRPORT_ID=WARR bun run packages/database/seed-alert-rules.ts
```

## Healthcheck

`alert-service` punya endpoint `/health` di port `3006` (default). Healthcheck Docker menggunakannya.
