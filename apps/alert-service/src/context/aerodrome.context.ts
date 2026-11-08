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
import { engineSettings } from "@/config/engine-settings";
import { pointInPolygon } from "../modules/engine/rules/geometry/geometry";
import type {
  AerodromeContextData,
  AerodromeFeatureContext,
  MovementTrack,
  OccupantTrack,
  PolygonOccupancy,
} from "../modules/engine/types";

function polygonBbox(
  polygon: [number, number][],
): [number, number, number, number] {
  let minLat = Number.POSITIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const [lat, lon] of polygon) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return [minLat, minLon, maxLat, maxLon];
}

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
    .map((f) => {
      const polygon = extractPolygon(
        f.geometry,
        f.layer,
        f.properties as Record<string, unknown>,
      );
      return {
        id: f.id,
        layer: f.layer,
        status: f.status,
        name: f.name,
        polygon,
        bbox: polygon.length > 0 ? polygonBbox(polygon) : undefined,
        properties: f.properties as Record<string, unknown>,
      };
    })
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

const TRACK_FRESHNESS_MS = 60_000;
/** Timestamp lebih dari ini di masa depan (clock skew / replayed data)
 *  dianggap tidak valid — kalau tidak, `now - ts` negatif selalu lolos
 *  freshness check dan track mati menempati polygon selamanya. */
const MAX_FUTURE_SKEW_MS = 30_000;
/** Track tanpa flag onGround tapi jelas airborne (alt MSL di atas ini)
 *  tidak boleh menempati permukaan — pesawat melintas di atas apron/taxiway
 *  plan-view footprint bukan occupancy. */
const AIRBORNE_ALTITUDE_FT = 500;

function isGroundTrackOccupying(t: MovementTrack, now: number): boolean {
  if (t.onGround === false) return false;
  if (t.onGround === undefined) {
    // Ground status unknown — only count if plausibly on the surface.
    if (t.altitude !== undefined && t.altitude > AIRBORNE_ALTITUDE_FT)
      return false;
  }
  const age = now - new Date(t.timestamp).getTime();
  return age <= TRACK_FRESHNESS_MS && age >= -MAX_FUTURE_SKEW_MS;
}

// Kapan sebuah feature terakhir punya occupant — occupancy dilaporkan tetap
// OCCUPIED selama occupancyStickyMs setelahnya supaya jitter posisi di batas
// polygon (atau satu snapshot track yang kelewat) tidak bikin highlight
// aerodrome kedip OCCUPIED↔AVAILABLE di frontend.
const lastOccupiedAt = new Map<string, number>();

/** Track yang berada di dalam tiap polygon: per polygon, dan per track (polygon mana saja yang ditempatinya). */
function containment(
  data: AerodromeContextData,
  ground: MovementTrack[],
): { byPolygon: Map<string, string[]>; byTrack: Map<string, string[]> } {
  const byPolygon = new Map<string, string[]>();
  const byTrack = new Map<string, string[]>();
  const add = (
    map: Map<string, string[]>,
    key: string,
    value: string,
  ): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const track of ground) {
    const point: [number, number] = [track.latitude, track.longitude];
    for (const f of data.features) {
      if (f.bbox && outsideBox(point, f.bbox)) continue;
      if (!pointInPolygon(point, f.polygon)) continue;
      add(byPolygon, f.id, track.trackId);
      add(byTrack, track.trackId, f.id);
    }
  }
  return { byPolygon, byTrack };
}

const outsideBox = (
  point: [number, number],
  bbox: [number, number, number, number],
): boolean =>
  point[0] < bbox[0] ||
  point[0] > bbox[2] ||
  point[1] < bbox[1] ||
  point[1] > bbox[3];

/** Occupancy generic untuk semua polygon feature: sebuah polygon OCCUPIED
 *  selama minimal satu track (ground, posisi masih segar) berada di dalamnya.
 *  Tidak ada per-cabang per tipe layer — semua polygon dicek sama. Juga mengembalikan
 *  track yang menempatinya, dengan posisinya. */
export function computeOccupancy(
  airportId: string,
  data: AerodromeContextData,
  tracks: MovementTrack[],
): { occupancy: PolygonOccupancy[]; occupants: OccupantTrack[] } {
  const now = Date.now();
  const ground = tracks.filter((t) => isGroundTrackOccupying(t, now));
  const { byPolygon, byTrack } = containment(data, ground);

  const occupancy: PolygonOccupancy[] = data.features.map((f) => {
    const aircraftIds = byPolygon.get(f.id) ?? [];
    const stickyKey = `${airportId}:${f.id}`;
    if (aircraftIds.length > 0) lastOccupiedAt.set(stickyKey, now);

    const last = lastOccupiedAt.get(stickyKey);
    const sticky =
      last !== undefined && now - last < engineSettings.occupancyStickyMs;
    if (aircraftIds.length === 0 && !sticky) lastOccupiedAt.delete(stickyKey);

    return {
      polygonId: f.id,
      type: f.layer,
      status: aircraftIds.length > 0 || sticky ? "OCCUPIED" : "AVAILABLE",
      aircraftIds,
      aircraftCount: aircraftIds.length,
    };
  });

  const occupants: OccupantTrack[] = ground.flatMap((track) => {
    const polygonIds = byTrack.get(track.trackId);
    if (!polygonIds) return [];
    return [
      {
        trackId: track.trackId,
        callsign: track.callsign,
        targetType: track.targetType,
        latitude: track.latitude,
        longitude: track.longitude,
        altitude: track.altitude,
        groundSpeed: track.groundSpeed,
        onGround: track.onGround,
        ageMs: now - new Date(track.timestamp).getTime(),
        polygonIds,
      },
    ];
  });

  return { occupancy, occupants };
}

export async function getAerodromeContext(
  airportId: string,
  tracks?: MovementTrack[],
): Promise<AerodromeContextData | null> {
  let data: AerodromeContextData | null = null;
  try {
    data = await getAerodromeGeometry(airportId);
  } catch (err) {
    logger.warn({ err, airportId }, "aerodrome geometry cache read failed");
  }
  if (!data) {
    data = await fetchAerodromeGeometry(airportId);
    if (data) {
      try {
        await setAerodromeGeometry(airportId, data, 60);
      } catch (err) {
        logger.warn(
          { err, airportId },
          "aerodrome geometry cache write failed",
        );
      }
    }
  }
  if (!data) return null;

  const { occupancy, occupants } = computeOccupancy(
    airportId,
    data,
    tracks ?? [],
  );
  const occupiedIds = new Set(
    occupancy.filter((o) => o.status === "OCCUPIED").map((o) => o.polygonId),
  );
  return {
    ...data,
    occupancy,
    occupants,
    runways: data.runways.map((r) => ({ ...r, active: occupiedIds.has(r.id) })),
    surfaces: data.surfaces.map((s) => ({
      ...s,
      active: occupiedIds.has(s.id),
    })),
  };
}

export async function cacheAerodromeGeometry(
  airportId: string,
  data: AerodromeContextData,
): Promise<void> {
  await setAerodromeGeometry(airportId, data);
}
