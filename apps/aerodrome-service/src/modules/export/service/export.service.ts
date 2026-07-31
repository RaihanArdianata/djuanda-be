import { aerodromeFeatures, db } from "@repo/database";
import type { GeoJson } from "@/types/geojson";

export const getAerodromeExport = async (): Promise<GeoJson> => {
  const features = await db.select().from(aerodromeFeatures);

  const geojson = {
    type: "FeatureCollection" as const,
    features: features.map((f) => ({
      type: "Feature" as const,
      id: f.id,
      geometry: f.geometry,
      properties: { layer: f.layer, name: f.name, ...(f.properties as object) },
    })),
  };

  return geojson as GeoJson;
};
