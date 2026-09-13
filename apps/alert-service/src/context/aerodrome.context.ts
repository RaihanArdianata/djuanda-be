import {
  type AerodromeFeature,
  aerodromeFeatures,
  aerodromeFeaturesSelectSchema,
  db,
} from "@repo/database";
import { logger } from "@repo/logger";
import {
  getAerodromeGeometry,
  setAerodromeGeometry,
} from "@/cache/context.cache";
import type {
  AerodromeContextData,
  AerodromeFeatureContext,
} from "../modules/engine/types";

function extractPolygon(
  geometry: unknown,
  _layer: string,
  _properties: Record<string, unknown>,
): [number, number][] {
  const geo = geometry as Record<string, unknown>;
  const type = geo.type as string;
  if (type === "Polygon") {
    const coords = (geo.coordinates as number[][][])[0];
    return coords.map(([lon, lat]) => [lat, lon]);
  }
  if (type === "MultiPolygon") {
    const polys = geo.coordinates as number[][][][];
    if (polys.length === 0) return [];
    const coords = polys[0][0];
    return coords.map(([lon, lat]) => [lat, lon]);
  }
  return [];
}

async function fetchFeatures(): Promise<AerodromeFeature[]> {
  const rows = await db.select().from(aerodromeFeatures);
  return aerodromeFeaturesSelectSchema.array().parse(rows);
}

function filterByAirport(
  features: AerodromeFeature[],
  airportId: string,
): AerodromeFeature[] {
  return features.filter((f) => {
    if (f.airportId === airportId) return true;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const icao = props.icao;
    const featureAirportId = props.airportId;
    if (icao === airportId || featureAirportId === airportId) return true;
    // Fallback: data lama/import tanpa airportId dianggap milik satu-satunya bandara.
    return f.airportId == null && icao == null && featureAirportId == null;
  });
}

async function fetchAerodromeGeometry(
  airportId: string,
): Promise<AerodromeContextData | null> {
  const all = await fetchFeatures();
  const filtered = filterByAirport(all, airportId);
  const processed: AerodromeFeatureContext[] = filtered
    .map((f) => ({
      id: f.id,
      layer: f.layer,
      status: f.status,
      name: f.name,
      polygon: extractPolygon(
        f.geometry,
        f.layer,
        f.properties as Record<string, unknown>,
      ),
      properties: f.properties as Record<string, unknown>,
    }))
    .filter((f) => f.polygon.length > 0);

  const runways = processed
    .filter((f) => f.layer === "RUNWAY")
    .map((f) => ({
      id: f.id,
      name: f.name ?? null,
      status: f.status ?? null,
      active:
        (f.properties as Record<string, unknown>)?.active === true ||
        f.status === "ACTIVE",
      polygon: f.polygon,
    }));

  // INACTIVE tetap dihitung sebagai zona incursion — sama seperti RESTRICTED,
  // bedanya hanya "dibatasi" vs "ditutup total".
  const surfaces = processed
    .filter((f) => f.layer === "TAXIWAY" || f.layer === "APRON")
    .map((f) => ({
      id: f.id,
      name: f.name ?? null,
      status: f.status ?? null,
      active:
        (f.properties as Record<string, unknown>)?.active === true ||
        f.status === "ACTIVE",
      type: f.layer as "TAXIWAY" | "APRON",
      polygon: f.polygon,
    }));

  const areas = processed
    .filter(
      (f) =>
        f.layer === "RESTRICTED" ||
        f.status === "RESTRICTED" ||
        f.properties.restricted === true,
    )
    .map((f) => ({
      id: f.id,
      name: f.name ?? null,
      status: f.status ?? null,
      type: (f.properties.type as string) ?? f.layer ?? "RESTRICTED",
      polygon: f.polygon,
    }));

  if (runways.length === 0 && surfaces.length === 0 && areas.length === 0) {
    return null;
  }

  const context = { features: processed, runways, surfaces, areas };

  logger.info(
    {
      airportId,
      features: processed.length,
      runways: runways.length,
      surfaces: surfaces.length,
      areas: areas.length,
      areaTypes: areas.map((a) => a.type),
    },
    "aerodrome context loaded",
  );

  return context;
}

export async function getAerodromeContext(
  airportId: string,
): Promise<AerodromeContextData | null> {
  let data = await getAerodromeGeometry(airportId);
  if (!data) {
    data = await fetchAerodromeGeometry(airportId);
    if (data) await setAerodromeGeometry(airportId, data, 60);
  }
  return data;
}

export async function cacheAerodromeGeometry(
  airportId: string,
  data: AerodromeContextData,
): Promise<void> {
  await setAerodromeGeometry(airportId, data);
}
