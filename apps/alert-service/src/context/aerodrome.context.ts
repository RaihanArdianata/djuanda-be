import type { AerodromeFeature } from "@repo/database";
import {
  getAerodromeGeometry,
  setAerodromeGeometry,
} from "@/cache/context.cache";
import { alertServiceEnv } from "@/config/env";
import type {
  AerodromeContextData,
  AerodromeFeatureContext,
} from "../modules/engine/types";

function extractPolygon(geometry: unknown): [number, number][] {
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
  const url = new URL("/features", alertServiceEnv.aerodromeServiceUrl);
  url.searchParams.set("limit", "200");
  const res = await fetch(url.toString());
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: { items: AerodromeFeature[] } };
  return json.data?.items ?? [];
}

function filterByAirport(
  features: AerodromeFeature[],
  airportId: string,
): AerodromeFeature[] {
  return features.filter((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>;
    return props.icao === airportId || props.airportId === airportId;
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
      name: f.name,
      polygon: extractPolygon(f.geometry),
      properties: f.properties as Record<string, unknown>,
    }))
    .filter((f) => f.polygon.length > 0);

  const runways = processed
    .filter((f) => f.layer === "RUNWAY")
    .map((f) => ({
      id: f.id,
      active: f.properties.active === true || f.properties.status === "ACTIVE",
      polygon: f.polygon,
    }));

  const surfaces = processed
    .filter((f) => f.layer === "TAXIWAY" || f.layer === "APRON")
    .map((f) => ({
      id: f.id,
      type: f.layer as "TAXIWAY" | "APRON",
      polygon: f.polygon,
    }));

  const areas = processed
    .filter((f) => f.layer === "RESTRICTED" || f.properties.restricted === true)
    .map((f) => ({
      id: f.id,
      type: (f.properties.type as string) ?? f.layer ?? "RESTRICTED",
      polygon: f.polygon,
    }));

  if (runways.length === 0 && surfaces.length === 0 && areas.length === 0) {
    return null;
  }

  return { features: processed, runways, surfaces, areas };
}

export async function getAerodromeContext(
  airportId: string,
): Promise<AerodromeContextData | null> {
  let data = await getAerodromeGeometry(airportId);
  if (!data) {
    data = await fetchAerodromeGeometry(airportId);
    if (data) await setAerodromeGeometry(airportId, data);
  }
  return data;
}

export async function cacheAerodromeGeometry(
  airportId: string,
  data: AerodromeContextData,
): Promise<void> {
  await setAerodromeGeometry(airportId, data);
}
