import type { AerodromeFeature } from "@repo/database";
import { logger } from "@repo/logger";
import {
  getAerodromeGeometry,
  setAerodromeGeometry,
} from "@/cache/context.cache";
import { alertServiceEnv } from "@/config/env";
import type {
  AerodromeContextData,
  AerodromeFeatureContext,
} from "../modules/engine/types";

const METERS_PER_DEGREE_LAT = 111320;

// Lebar default saat feature disimpan sebagai LineString.
// Unit meter. Bisa di-override via properties.width atau properties.buffer.
const LINE_WIDTHS: Record<string, number | undefined> = {
  RUNWAY: 45,
  TAXIWAY: 22.5,
  AEROWAY: 30,
  ROAD: 8,
  BARRIER: 2,
};

function metersPerDegreeLon(latitude: number): number {
  return METERS_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180);
}

function segmentVectorMeters(
  a: [number, number],
  b: [number, number],
): [number, number] {
  const mLon = metersPerDegreeLon(a[1]);
  const dx = (b[0] - a[0]) * mLon;
  const dy = (b[1] - a[1]) * METERS_PER_DEGREE_LAT;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [0, 0];
  return [dx / len, dy / len];
}

function leftNormal(v: [number, number]): [number, number] {
  return [-v[1], v[0]];
}

function applyMetersOffset(
  lon: number,
  lat: number,
  dxMeters: number,
  dyMeters: number,
): [number, number] {
  const dLat = dyMeters / METERS_PER_DEGREE_LAT;
  const dLon = dxMeters / metersPerDegreeLon(lat);
  return [lat + dLat, lon + dLon];
}

function averageNormals(parts: [number, number][]): [number, number] {
  const nx = parts.reduce((s, p) => s + p[0], 0) / parts.length;
  const ny = parts.reduce((s, p) => s + p[1], 0) / parts.length;
  const len = Math.hypot(nx, ny);
  if (len === 0) return parts[0] ?? [0, 0];
  return [nx / len, ny / len];
}

function collectNormalParts(
  coords: [number, number][],
  index: number,
): [number, number][] {
  const parts: [number, number][] = [];
  if (index > 0) {
    const v = segmentVectorMeters(coords[index - 1], coords[index]);
    const ln = leftNormal(v);
    if (ln[0] !== 0 || ln[1] !== 0) parts.push(ln);
  }
  if (index < coords.length - 1) {
    const v = segmentVectorMeters(coords[index], coords[index + 1]);
    const ln = leftNormal(v);
    if (ln[0] !== 0 || ln[1] !== 0) parts.push(ln);
  }
  return parts;
}

function computeNormals(coords: [number, number][]): [number, number][] {
  return coords.map((_, i) => {
    const parts = collectNormalParts(coords, i);
    if (parts.length === 0) return [0, 0];
    return averageNormals(parts);
  });
}

function buildRing(
  coords: [number, number][],
  normals: [number, number][],
  halfWidth: number,
): [number, number][] {
  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    const [nx, ny] = normals[i];
    left.push(applyMetersOffset(lon, lat, nx * halfWidth, ny * halfWidth));
    right.push(applyMetersOffset(lon, lat, -nx * halfWidth, -ny * halfWidth));
  }

  const ring = [...left, ...right.reverse()];
  if (ring.length > 0) ring.push(ring[0]);
  return ring;
}

function bufferLineString(
  coords: [number, number][],
  widthMeters: number,
): [number, number][] {
  if (coords.length < 2) return [];
  const normals = computeNormals(coords);
  return buildRing(coords, normals, widthMeters / 2);
}

function getLineBufferWidth(
  layer: string,
  properties: Record<string, unknown>,
): number | undefined {
  const widthFromProp =
    (properties?.width as number | undefined) ??
    (properties?.buffer as number | undefined);
  if (typeof widthFromProp === "number" && widthFromProp > 0) {
    return widthFromProp;
  }
  return LINE_WIDTHS[layer];
}

function extractPolygon(
  geometry: unknown,
  layer: string,
  properties: Record<string, unknown>,
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
  if (type === "LineString") {
    const coords = geo.coordinates as [number, number][];
    const width = getLineBufferWidth(layer, properties);
    if (!width) return [];
    return bufferLineString(coords, width);
  }
  if (type === "MultiLineString") {
    const lines = geo.coordinates as [number, number][][];
    if (lines.length === 0) return [];
    const width = getLineBufferWidth(layer, properties);
    if (!width) return [];
    return bufferLineString(lines[0], width);
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
    .filter((f) => f.layer === "RUNWAY" && f.status !== "INACTIVE")
    .map((f) => ({
      id: f.id,
      active:
        f.status === "ACTIVE" ||
        f.properties.active === true ||
        f.properties.status === "ACTIVE",
      polygon: f.polygon,
    }));

  const surfaces = processed
    .filter(
      (f) =>
        (f.layer === "TAXIWAY" || f.layer === "APRON") &&
        f.status !== "INACTIVE",
    )
    .map((f) => ({
      id: f.id,
      type: f.layer as "TAXIWAY" | "APRON",
      polygon: f.polygon,
    }));

  const areas = processed
    .filter(
      (f) =>
        (f.layer === "RESTRICTED" ||
          f.status === "RESTRICTED" ||
          f.properties.restricted === true) &&
        f.status !== "INACTIVE",
    )
    .map((f) => ({
      id: f.id,
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
