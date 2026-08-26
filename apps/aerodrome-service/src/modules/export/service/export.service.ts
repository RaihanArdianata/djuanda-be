import { aerodromeFeatures, db } from "@repo/database";
import type { GeoJson, GeoJsonGeometry } from "@/types/geojson";

export const getAerodromeExport = async (): Promise<GeoJson> => {
  const features = await db.select().from(aerodromeFeatures);

  const geojson = {
    type: "FeatureCollection" as const,
    features: features.map((f) => ({
      type: "Feature" as const,
      id: f.id,
      geometry: f.geometry as GeoJsonGeometry,
      properties: {
        layer: f.layer,
        name: f.name,
        ...(f.properties as object),
        status: f.status,
      },
    })),
  };

  return geojson as GeoJson;
};
