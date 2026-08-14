import { aerodromeFeatures, db } from "@repo/database";
import { eq, sql } from "drizzle-orm";
import type { Layer } from "@/types/layer";
import type { LayerFilter } from "../validator/layer.validator";

export const getLayers = async (params: LayerFilter): Promise<Layer[]> => {
  const whereClause = params.name
    ? eq(aerodromeFeatures.layer, params.name)
    : undefined;

  const counts = await db
    .select({
      layer: aerodromeFeatures.layer,
      count: sql<number>`count(*)::int`,
    })
    .from(aerodromeFeatures)
    .where(whereClause)
    .groupBy(aerodromeFeatures.layer);

  const countMap = new Map(counts.map((c) => [c.layer, c.count]));

  const layers = Array.from(countMap.entries()).map(
    ([layer, featureCount]) => ({
      layer: layer as Layer["layer"],
      featureCount,
    }),
  );

  return layers;
};
