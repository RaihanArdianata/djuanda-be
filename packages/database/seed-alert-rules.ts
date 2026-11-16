import { and, eq } from "drizzle-orm";
import { db, pool } from ".";
import { alertRules } from "./drizzle/schema";

const airportId: string = process.env.AEROSWARM_AIRPORT_ID ?? "WARR";

// biome-ignore-start lint/suspicious/noConsole: seed output
const defaultRules = [
  {
    type: "ALERT_ENGINE",
    enabled: true,
    // Penyetelan engine milik operator, jadi seed ulang tidak menimpa isian pengguna.
    preserveConfiguration: true,
    description:
      "Penyetelan engine alert: penyatuan track kembar antar sensor, masa tenggang alert stale, dan masa tahan status terisi permukaan. Bukan pendeteksi.",
    configuration: {
      twinRadiusM: 60,
      twinMaxSpeedDiffKt: 15,
      staleGraceSeconds: 20,
      occupancyStickyMs: 5000,
    },
    documentation: {
      parameters: {
        twinRadiusM:
          "Radar, ADS-B, dan MLAT yang belum menyatu menghasilkan beberapa track untuk satu pesawat. Track tanpa nama sedekat ini (meter) dengan track bernama dari jenis yang sama dianggap pesawat yang sama dan tidak dihitung dua kali. 0 = tidak dinilai dari posisi (hanya dari callsign). Bawaan 60.",
        twinMaxSpeedDiffKt:
          "Selisih kecepatan paling besar (knot) agar dua track dianggap pesawat yang sama. Bawaan 15.",
        staleGraceSeconds:
          "Alert aktif yang kandidatnya tidak terlihat lagi baru dibersihkan setelah masa ini (detik). Meredam kedip dari jitter posisi di batas area. Bawaan 20.",
        occupancyStickyMs:
          "Runway atau taxiway tetap berstatus terisi selama ini (ms) setelah target terakhir terlihat di dalamnya. Meredam kedip status di batas poligon. Bawaan 5000.",
      },
      notes:
        "Nilai env ALERT_TWIN_RADIUS_M, ALERT_TWIN_MAX_SPEED_DIFF_KT, ALERT_STALE_GRACE_SECONDS, dan ALERT_OCCUPANCY_STICKY_MS menjadi nilai awal; isian di sini menggantikannya tanpa restart, dan yang dikosongkan kembali ke env.",
    },
  },
  {
    type: "ALERT_AREA",
    enabled: true,
    // Pusat dan radius adalah ketentuan bandara, jadi seed ulang tidak menimpa isian pengguna.
    preserveConfiguration: true,
    description:
      "Area alert bandara: alert hanya berlaku untuk target di dalam radius darat atau radius udara dari titik pusat bandara. Aturan ini tidak membuat alert sendiri.",
    configuration: {
      centerLatitude: -7.3797,
      centerLongitude: 112.7868,
      groundRadiusM: 5000,
      airRadiusNm: 15,
      airCeilingFt: 10000,
      interestRadiusNm: 20,
    },
    documentation: {
      parameters: {
        centerLatitude:
          "Lintang titik pusat bandara (ARP), derajat desimal. Juanda (WARR): -7.3797.",
        centerLongitude:
          "Bujur titik pusat bandara (ARP), derajat desimal. Juanda (WARR): 112.7868.",
        groundRadiusM:
          "Radius area darat (meter): target di darat (taksi, parkir, kendaraan, lepas landas dan mendarat) di luar radius ini tidak ikut aturan alert apa pun. Bawaan 5000.",
        airRadiusNm:
          "Radius area udara (NM): pesawat di udara di luar radius ini tidak ikut aturan alert apa pun. Bawaan 15.",
        airCeilingFt:
          "Tinggi kubah area udara di atas titik pusat (ft). Area udara berbentuk kubah: setinggi ini di atas pusat dan mengecil ke tepi radius. Pesawat di atas kubah tidak ikut aturan alert. Kosong = tanpa batas tinggi. Bawaan di seed 10000.",
        interestRadiusNm:
          "Radius area cakupan surveilans (NM): kotak di sekeliling titik pusat tempat gambaran udara disimpan. Track di luar kotak dibuang kecuali sedang menuju ke dalamnya, dan pesawat yang sudah keluar dari kotak dihapus. Harus lebih besar dari radius area udara supaya semua yang dinilai alert ada di gambaran. Kosong = pakai INTEREST_BBOX dari env (bila ada). Berlaku tanpa restart.",
      },
      notes:
        "Tanpa titik pusat (kosong dan ALERT_AREA_CENTER tidak diisi), semua target dievaluasi tanpa batas area. Nonaktifkan aturan ini untuk mematikan batas area.",
    },
  },
  {
    type: "STCA",
    enabled: true,
    description:
      "Short Term Conflict Alert — memprediksi jarak 2 objek dalam waktu beberapa detik ke depan.",
    configuration: {
      predictionTimeSeconds: 60,
      highSeparationMeters: 5000,
      minAltitudeFt: 1500,
      midSeparationMeters: 3000,
      midAltitudeFt: 1000,
      closeSeparationMeters: 50,
      minimumHorizontalSeparationNm: 3,
      minimumVerticalSeparationFt: 1000,
      requireAltitude: true,
      includeSurface: true,
      surfaceMinimumSeparationMeters: 50,
      surfacePredictionTimeSeconds: 10,
    },
    documentation: {
      parameters: {
        predictionTimeSeconds:
          "Waktu prediksi ke depan (detik) untuk memperkirakan posisi kedua track (kategori AIR_HIGH dan AIR_MID). Bawaan 60.",
        highSeparationMeters:
          "AIR_HIGH: jarak horizontal minimum (meter) antara dua track di atas 1500 ft. Bawaan 5000.",
        minAltitudeFt:
          "AIR_HIGH: batas bawah ketinggian (feet). Pasangan pesawat harus memiliki ketinggian >= ini untuk masuk kategori AIR_HIGH. Bawaan 1500.",
        midSeparationMeters:
          "AIR_MID: jarak horizontal minimum (meter) antara dua track pada rentang ketinggian menengah. Bawaan 3000.",
        midAltitudeFt:
          "AIR_MID: batas bawah ketinggian (feet) untuk kategori menengah. Ketinggian harus > ini dan < minAltitudeFt. Bawaan 1000.",
        closeSeparationMeters:
          "AIR_CLOSE: jarak 2D langsung saat ini (meter) tanpa prediksi. Bawaan 50.",
        minimumHorizontalSeparationNm:
          "AIR_HIGH: jarak horizontal minimum (nautical miles) fallback bila highSeparationMeters tidak diset. Bawaan 3.",
        minimumVerticalSeparationFt:
          "AIR: batas selisih ketinggian (feet). STCA hanya bila selisih tinggi kedua track sama dengan atau di bawah nilai ini; lebih dari ini dianggap terpisah vertikal walau jalurnya berpotongan. Bawaan 1000; isi 0 untuk mematikan pemeriksaan vertikal.",
        requireAltitude:
          "true (bawaan) = track yang tidak melaporkan ketinggian (banyak track radar) tidak ikut STCA. false = ikut dihitung, hanya jarak horizontal yang dinilai.",
        includeSurface:
          "true = STCA darat ikut menyala: dua target di darat dinilai terpisah dari STCA udara, dengan ambang sendiri di bawah. Alert membawa data.domain SURFACE dan data.category SURFACE.",
        surfaceMinimumSeparationMeters:
          "STCA darat: jarak minimum (meter) antara dua target di darat. Bawaan 50. Hanya dipakai bila includeSurface true.",
        surfacePredictionTimeSeconds:
          "STCA darat: waktu prediksi ke depan (detik). Bawaan 10. Hanya dipakai bila includeSurface true.",
      },
      examples: [
        {
          name: "AIR_HIGH — 2 pesawat di atas 1500 ft, dekat",
          topic: "asmgcs.tracks",
          explanation:
            "Dua track di 3000 ft pada posisi sama. data.domain=AIR, data.category=AIR_HIGH. Ambang 3 NM / 1000 ft / 60 dtk.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-HIGH-1",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3798,
                longitude: 112.7874,
                altitudeFt: 3000,
                groundSpeedKt: 150,
                heading: 90,
                onGround: false,
                callsign: "HIGH1",
              },
            },
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-HIGH-2",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3798,
                longitude: 112.7874,
                altitudeFt: 3000,
                groundSpeedKt: 150,
                heading: 270,
                onGround: false,
                callsign: "HIGH2",
              },
            },
          ],
        },
        {
          name: "AIR_MID — 2 pesawat 1400 ft, prediksi jarak 2 km (<= 3 km)",
          topic: "asmgcs.tracks",
          explanation:
            "Dua track 1400 ft (>1000 ft, <1500 ft), prediksi jarak terpisah 2 km. data.category=AIR_MID.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-MID-1",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3797,
                longitude: 112.7868,
                altitudeFt: 1400,
                groundSpeedKt: 80,
                heading: 90,
                onGround: false,
                callsign: "MID1",
              },
            },
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-MID-2",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3797,
                longitude: 112.7886,
                altitudeFt: 1400,
                groundSpeedKt: 80,
                heading: 270,
                onGround: false,
                callsign: "MID2",
              },
            },
          ],
        },
        {
          name: "AIR_CLOSE — 400 ft / 30 kt, jarak saat ini < 50 m",
          topic: "asmgcs.tracks",
          explanation:
            "Dua pesawat 400 ft / 30 kt (masih udara) jarak saat ini ~40 m (< 50 m). data.category=AIR_CLOSE. Jarak 2D saat ini, bukan prediksi.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-CLOSE-1",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3797,
                longitude: 112.7868,
                altitudeFt: 400,
                groundSpeedKt: 30,
                heading: 90,
                onGround: false,
                callsign: "CLOSE1",
              },
            },
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-CLOSE-2",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3797,
                longitude: 112.7871,
                altitudeFt: 400,
                groundSpeedKt: 30,
                heading: 270,
                onGround: false,
                callsign: "CLOSE2",
              },
            },
          ],
        },
        {
          name: "SURFACE — 2 target di darat < 50 m",
          topic: "asmgcs.tracks",
          explanation:
            "Dua track onGround pada posisi hampir sama. data.domain=SURFACE, data.category=SURFACE. Ambang 50 m / 10 dtk. includeSurface harus true.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-GND-1",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3797,
                longitude: 112.7868,
                altitudeFt: 0,
                groundSpeedKt: 5,
                heading: 90,
                onGround: true,
                callsign: "GND1",
              },
            },
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-GND-2",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3797,
                longitude: 112.78685,
                altitudeFt: 0,
                groundSpeedKt: 5,
                heading: 270,
                onGround: true,
                callsign: "GND2",
              },
            },
          ],
        },
      ],
      notes:
        "type tetap STCA. Frontend membedakan STCA Udara / STCA Darat dari data.domain (AIR|SURFACE) dan sub-kategori dari data.category (AIR_HIGH|AIR_MID|AIR_CLOSE|SURFACE). Evaluasi ladder berurutan: AIR_CLOSE -> AIR_MID -> AIR_HIGH. 400 ft / 30 kt adalah udara (plafon taksi 100 ft). Track harus berada di bandara WARR. Kalau hanya 1 track, tidak ada pasangan untuk dicek.",
    },
  },
  {
    type: "RUNWAY_INCURSION",
    enabled: true,
    description:
      "Runway Incursion Alert — memicu alert saat track memasuki runway yang sedang aktif.",
    configuration: {
      active: true,
    },
    documentation: {
      parameters: {
        active:
          "Filter runway aktif saja. Kalau true, hanya runway dengan active=true yang dipantau.",
      },
      examples: [
        {
          name: "Kendaraan masuk runway aktif",
          topic: "asmgcs.tracks",
          aerodromeRequirement:
            "Butuh runway dengan layer 'RUNWAY', properties.active: true atau status: 'ACTIVE', dan polygon runway.",
          explanation:
            "Kirim track di dalam polygon runway aktif untuk trigger RUNWAY_INCURSION.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "RWY-1",
                airportId: "WARR",
                targetType: "VEHICLE",
                latitude: -7.377,
                longitude: 112.786,
                altitudeFt: 0,
                groundSpeedKt: 10,
                heading: 180,
                onGround: true,
                callsign: "RWY1",
              },
            },
          ],
        },
      ],
      notes:
        "Aerodrome feature di aerodrome-service harus punya polygon runway dan airportId WARR.",
    },
  },
  {
    type: "TAXIWAY_APRON_INCURSION",
    enabled: true,
    description:
      "Taxiway / Apron Incursion Alert — memicu alert saat track keluar dari expected route atau masuk ke area taxiway/apron.",
    configuration: {
      maxDistanceMeters: 50,
    },
    documentation: {
      parameters: {
        maxDistanceMeters:
          "Jarak toleransi (meter) dari expected route atau untuk tetap dianggap on-route.",
        expectedRoute:
          "Array koordinat [[lat,lon], ...] rute yang diharapkan — opsional. Kalau tidak diisi, rule pakai polygon taxiway/apron.",
      },
      examples: [
        {
          name: "Kendaraan masuk taxiway/apron",
          topic: "asmgcs.tracks",
          aerodromeRequirement:
            "Butuh surface dengan layer 'TAXIWAY' atau 'APRON' dan polygon.",
          explanation:
            "Kirim track di dalam polygon taxiway atau apron untuk trigger TAXIWAY_APRON_INCURSION.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "TXW-1",
                airportId: "WARR",
                targetType: "VEHICLE",
                latitude: -7.38,
                longitude: 112.789,
                altitudeFt: 0,
                groundSpeedKt: 8,
                heading: 0,
                onGround: true,
                callsign: "TXW1",
              },
            },
          ],
        },
      ],
      notes:
        "Kalau expectedRoute diisi, alert trigger saat track off-route lebih dari maxDistanceMeters. Kalau tidak, trigger saat masuk polygon taxiway/apron.",
    },
  },
  {
    type: "AREA_PENETRATION",
    enabled: true,
    description:
      "Area Penetration Alert — memicu alert saat track memasuki area terbatas / kritis.",
    configuration: {},
    documentation: {
      parameters: {
        areas:
          "Array area restricted yang akan dipantau. Kalau tidak diisi, rule pakai area dari aerodrome context.",
      },
      examples: [
        {
          name: "Pesawat masuk restricted area",
          topic: "asmgcs.tracks",
          aerodromeRequirement:
            "Butuh restricted area dengan layer 'RESTRICTED' atau properties.restricted: true dan polygon.",
          explanation:
            "Kirim track di dalam polygon restricted area untuk trigger AREA_PENETRATION.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "AREA-1",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.365,
                longitude: 112.775,
                altitudeFt: 50,
                groundSpeedKt: 5,
                heading: 0,
                onGround: true,
                callsign: "AREA1",
              },
            },
          ],
        },
      ],
      notes:
        "Area harus ditandai restricted di aerodrome-service dan punya airportId WARR.",
    },
  },
  {
    type: "DEVIATION",
    enabled: true,
    description:
      "Deviation Alert — memicu alert saat track menyimpang dari expected route melebihi ambang batas.",
    configuration: {
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 300,
    },
    documentation: {
      parameters: {
        maxDistanceMeters:
          "Jarak horizontal maksimum (meter) yang diperbolehkan dari expected route.",
        maxAltitudeDeviationFt:
          "Deviasi altitude maksimum (feet) dari rute yang diharapkan.",
        expectedRoute:
          "Array koordinat [[lat,lon], ...] rute yang diharapkan — wajib untuk trigger.",
        expectedRouteTimes:
          "Array waktu (ISO string) yang diharapkan di tiap titik expectedRoute — opsional.",
        maximumTimeDeviation:
          "Toleransi keterlambatan waktu (detik) dari expectedRouteTimes — opsional.",
      },
      examples: [
        {
          name: "Pesawat menyimpang dari rute",
          topic: "asmgcs.tracks",
          explanation:
            "Kirim track dengan posisi di luar expectedRoute. Rule DEVIATION membutuhkan expectedRoute di configuration.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "DEV-1",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.39,
                longitude: 112.81,
                altitudeFt: 500,
                groundSpeedKt: 120,
                heading: 45,
                onGround: false,
                callsign: "DEV1",
              },
            },
          ],
        },
      ],
      notes:
        "Untuk trigger otomatis dari AFTN, parser FPL harus menghasilkan expectedRoute. Saat ini perlu ditambahkan manual di configuration atau modifikasi fpl.parser.ts.",
    },
  },
  {
    type: "WEATHER_MINIMA",
    enabled: true,
    // Nilai minima berasal dari ketentuan bandara, jadi seed tidak mengisinya dan tidak menimpa isian pengguna.
    preserveConfiguration: true,
    description:
      "Cuaca di bawah minima yang ditentukan bandara (jarak pandang, plafon, RVR). Pengamatan = CRITICAL, prakiraan TAF = WARNING.",
    configuration: {},
    documentation: {
      parameters: {
        visibilityM:
          "Jarak pandang minimum (meter). Pengamatan di bawah nilai ini memicu alert. Kosong = tidak diperiksa.",
        ceilingFt:
          "Plafon minimum (feet di atas tanah; dasar awan BKN/OVC/VV terendah). Kosong = tidak diperiksa.",
        rvrM: "RVR minimum (meter). Kosong = tidak diperiksa. Data RVR yang tidak ada tidak memicu alert.",
        rvrRunways:
          'Daftar runway yang diperiksa untuk RVR, mis. ["10","28"]. Kosong = semua yang dilaporkan.',
        forecastHours:
          "Berapa jam ke depan TAF diperiksa untuk peringatan dini (WARNING). Bawaan 3; 0 = hanya pengamatan.",
        maxObservationAgeMinutes:
          "Pengamatan yang lebih tua dari ini (menurut jam di laporannya) diabaikan. Bawaan 120.",
      },
      notes:
        "Tanpa satu pun ambang yang diisi, rule ini tidak menghasilkan alert. Nilai minima tidak punya bawaan: isi sesuai ketentuan bandara.",
    },
  },
  {
    type: "WEATHER_CROSSWIND",
    enabled: true,
    preserveConfiguration: true,
    description:
      "Angin silang di runway melewati batas yang ditentukan bandara. Hembusan (gust) dihitung. Pengamatan = CRITICAL, prakiraan TAF = WARNING.",
    configuration: {},
    documentation: {
      parameters: {
        crosswindKt:
          "Batas angin silang (knot). Wajib diisi; kosong = rule tidak aktif.",
        runways:
          'Opsional. Daftar runway dengan heading magnetik, mis. [{"designator":"10","magneticHeadingDeg":98}]. Kosong = runway aktif dari data aerodrome (heading dari sumbu polygonnya).',
        variationEastDeg:
          "Variasi magnetik (derajat, positif ke timur) untuk mengubah heading magnetik di `runways` menjadi true. Angin METAR dalam derajat true. Heading dari polygon sudah true.",
        onlyActiveRunways:
          "true (bawaan) = hanya runway berstatus aktif di data aerodrome.",
        forecastHours:
          "Berapa jam ke depan TAF diperiksa (WARNING). Bawaan 3; 0 = hanya pengamatan.",
        maxObservationAgeMinutes:
          "Pengamatan yang lebih tua dari ini diabaikan. Bawaan 120.",
      },
      notes:
        "Angin silang sama besarnya di kedua arah runway, jadi arah yang dipakai tidak perlu diketahui. Batasnya diisi dari ketentuan bandara atau operator; tidak ada nilai bawaan.",
    },
  },
  {
    type: "WEATHER_CATEGORY_DROP",
    enabled: true,
    preserveConfiguration: true,
    description:
      "Kategori penerbangan (VFR/MVFR/IFR/LIFR) turun ke tingkat yang ditentukan atau lebih buruk. Pengamatan = CRITICAL, prakiraan TAF = WARNING.",
    configuration: {},
    documentation: {
      parameters: {
        alertFrom:
          'Kategori terbaik yang masih memicu alert: "MVFR", "IFR", atau "LIFR". Mis. "IFR" memicu pada IFR dan LIFR. Kosong atau tidak valid = rule tidak aktif.',
        forecastHours:
          "Berapa jam ke depan TAF diperiksa (WARNING). Bawaan 3; 0 = hanya pengamatan.",
        maxObservationAgeMinutes:
          "Pengamatan yang lebih tua dari ini diabaikan. Bawaan 120.",
      },
      notes:
        "Kategori mengikuti definisi FAA (ICAO tidak mendefinisikannya): LIFR di bawah 500 ft atau 1 mil, IFR di bawah 1.000 ft atau 3 mil, MVFR sampai 3.000 ft atau 5 mil.",
    },
  },
  {
    type: "WEATHER_THUNDERSTORM",
    enabled: true,
    preserveConfiguration: true,
    description:
      "Badai petir dan awan CB. Badai di bandara pada pengamatan = CRITICAL; di sekitar (VCTS) atau CB, atau prakiraan TAF = WARNING.",
    configuration: { forecastHours: 3 },
    documentation: {
      parameters: {
        forecastHours:
          "Berapa jam ke depan TAF diperiksa untuk badai petir atau CB. Bawaan 3; 0 = hanya pengamatan.",
        maxObservationAgeMinutes:
          "Pengamatan yang lebih tua dari ini diabaikan. Bawaan 120.",
      },
      notes: "Tidak butuh ambang.",
    },
  },
];

// Mengisi hanya jenis tertentu, mis. `SEED_RULE_TYPES=ALERT_AREA`, tanpa menyentuh aturan lain (seed penuh menimpa konfigurasi
// aturan yang tidak ditandai preserveConfiguration).
const onlyTypes = (process.env.SEED_RULE_TYPES ?? "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

async function seed(): Promise<void> {
  for (const rule of defaultRules) {
    if (onlyTypes.length > 0 && !onlyTypes.includes(rule.type)) continue;
    const existing = await db
      .select({ id: alertRules.id })
      .from(alertRules)
      .where(
        and(
          eq(alertRules.airportId, airportId),
          eq(alertRules.type, rule.type),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(alertRules)
        .set({
          description: rule.description,
          documentation: rule.documentation,
          // Rule yang nilainya diisi pengguna (mis. minima cuaca) tidak boleh ditimpa saat seed ulang.
          ...("preserveConfiguration" in rule && rule.preserveConfiguration
            ? {}
            : { configuration: rule.configuration, enabled: rule.enabled }),
          updatedAt: new Date(),
        })
        .where(eq(alertRules.id, existing[0].id));
      console.log(`Rule ${rule.type} for ${airportId} updated.`);
      continue;
    }

    await db.insert(alertRules).values({
      airportId,
      type: rule.type,
      description: rule.description,
      documentation: rule.documentation,
      enabled: rule.enabled,
      configuration: rule.configuration,
    });

    console.log(`Seeded rule ${rule.type} for ${airportId}.`);
  }

  console.log(`Alert rule seeding finished for ${airportId}.`);
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
// biome-ignore-end lint/suspicious/noConsole: seed output
