import { and, eq } from "drizzle-orm";
import { db, pool } from ".";
import { alertRules } from "./drizzle/schema";

const airportId: string = process.env.AEROSWARM_AIRPORT_ID ?? "WARR";

// biome-ignore-start lint/suspicious/noConsole: seed output
const defaultRules = [
  {
    type: "STCA",
    enabled: true,
    configuration: {
      predictionTimeSeconds: 60,
      minimumHorizontalSeparationNm: 3,
    },
  },
  {
    type: "RUNWAY_INCURSION",
    enabled: true,
    configuration: {
      active: true,
    },
  },
  {
    type: "TAXIWAY_APRON_INCURSION",
    enabled: true,
    configuration: {
      maxDistanceMeters: 50,
    },
  },
  {
    type: "AREA_PENETRATION",
    enabled: true,
    configuration: {},
  },
  {
    type: "DEVIATION",
    enabled: true,
    configuration: {
      maxDistanceMeters: 500,
      maxAltitudeDeviationFt: 300,
    },
  },
];

async function seed(): Promise<void> {
  for (const rule of defaultRules) {
    const existing = await db
      .select()
      .from(alertRules)
      .where(
        and(
          eq(alertRules.airportId, airportId),
          eq(alertRules.type, rule.type),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(
        `Rule ${rule.type} for ${airportId} already exists, skipping.`,
      );
      continue;
    }

    await db.insert(alertRules).values({
      airportId,
      type: rule.type,
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
