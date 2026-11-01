import { and, eq } from "drizzle-orm";
import { db, pool } from ".";
import { alertRules } from "./drizzle/schema";

const airportId: string = process.env.AEROSWARM_AIRPORT_ID ?? "WARR";

// biome-ignore-start lint/suspicious/noConsole: seed output
const defaultRules = [
  {
    type: "STCA",
    enabled: true,
    description:
      "Short Term Conflict Alert — memprediksi jarak 2 objek dalam waktu beberapa detik ke depan.",
    configuration: {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
    },
    documentation: {
      parameters: {
        predictionTimeSeconds:
          "Waktu prediksi ke depan (detik) untuk memperkirakan posisi kedua track.",
        minimumHorizontalSeparationNm:
          "Jarak horizontal minimum (nautical miles) antara dua track.",
        minimumVerticalSeparationFt:
          "Jarak vertikal minimum (feet) antara dua track — opsional.",
        includeSurface:
          "true = target di darat ikut dihitung (bawaan false: konflik di darat ditangani aturan incursion).",
      },
      examples: [
        {
          name: "2 pesawat di udara, posisi sama",
          topic: "asmgcs.tracks",
          explanation:
            "Kirim 2 track di udara (onGround false) pada posisi sama / sangat dekat. Jarak 0 NM < 3 NM akan trigger STCA. Target di darat tidak dihitung.",
          payloads: [
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-1",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3798,
                longitude: 112.7874,
                altitudeFt: 3000,
                groundSpeedKt: 150,
                heading: 90,
                onGround: false,
                callsign: "STCA1",
              },
            },
            {
              eventType: "TRACK_UPDATED",
              timestamp: "2026-05-30T12:00:00.000Z",
              data: {
                trackId: "STCA-2",
                airportId: "WARR",
                targetType: "AIRCRAFT",
                latitude: -7.3798,
                longitude: 112.7874,
                altitudeFt: 3000,
                groundSpeedKt: 150,
                heading: 270,
                onGround: false,
                callsign: "STCA2",
              },
            },
          ],
        },
      ],
      notes:
        "Track harus berada di bandara WARR. Kalau hanya 1 track, tidak ada pasangan untuk dicek.",
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
];

async function seed(): Promise<void> {
  for (const rule of defaultRules) {
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
          configuration: rule.configuration,
          enabled: rule.enabled,
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
