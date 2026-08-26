import { aerodromeFeatures, db } from "@repo/database";
import { extractPolygon } from "@/lib/aerodrome-polygon";
import type { GeoJson, GeoJsonGeometry } from "@/types/geojson";

function toExportGeometry(
  geometry: unknown,
  layer: string,
  properties: unknown,
): GeoJsonGeometry {
  const geo = geometry as { type?: string };
  if (geo.type === "LineString" || geo.type === "MultiLineString") {
    const ring = extractPolygon(
      geometry,
      layer,
      (properties ?? {}) as Record<string, unknown>,
    );
    if (ring.length > 0) {
      return {
        type: "Polygon",
        coordinates: [ring.map(([lat, lon]) => [lon, lat])],
      } as GeoJsonGeometry;
    }
  }
  return geometry as GeoJsonGeometry;
}

export const getAerodromeExport = async (): Promise<GeoJson> => {
  const features = await db.select().from(aerodromeFeatures);

  const geojson = {
    type: "FeatureCollection" as const,
    features: features.map((f) => ({
      type: "Feature" as const,
      id: f.id,
      geometry: toExportGeometry(f.geometry, f.layer, f.properties),
      properties: {
        layer: f.layer,
        name: f.name,
        status: f.status,
        ...(f.properties as object),
      },
    })),
  };

  return geojson as GeoJson;
};
