import { aerodromeFeatures, db } from "@repo/database";
import type { GeoJson, GeoJsonGeometry } from "@/types/geojson";

export const getAerodromeExport = async (): Promise<GeoJson> => {
  const features = await db.select().from(aerodromeFeatures);

  const geojson = {
    type: "FeatureCollection" as const,
    features: features.map((f) => {
      const props = (f.properties ?? {}) as Record<string, unknown>;
      const active =
        typeof props.active === "boolean"
          ? props.active
          : f.status === "ACTIVE";
      return {
        type: "Feature" as const,
        id: f.id,
        geometry: f.geometry as GeoJsonGeometry,
        properties: {
          layer: f.layer,
          name: f.name,
          ...props,
          status: f.status,
          active,
        },
      };
    }),
  };

  return geojson as GeoJson;
};
