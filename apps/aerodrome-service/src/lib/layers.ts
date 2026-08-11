import type { LayerName } from "@repo/database";

interface LayerRule {
  match: (props: Record<string, unknown>) => boolean;
  layer: LayerName;
}

// Mapping property -> layer
const LAYER_RULES: LayerRule[] = [
  {
    match: (p: Record<string, unknown>) => {
      if (!p.aeroway) return false;
      return !["taxiway", "runway", "aerodrome", "apron", "terminal"].includes(
        p.aeroway as string,
      );
    },
    layer: "AEROWAY",
  },
  {
    match: (p: Record<string, unknown>) => p.aeroway === "runway",
    layer: "RUNWAY",
  },
  {
    match: (p: Record<string, unknown>) => p.aeroway === "taxiway",
    layer: "TAXIWAY",
  },
  {
    match: (p: Record<string, unknown>) => p.aeroway === "apron",
    layer: "APRON",
  },
  {
    match: (p: Record<string, unknown>) => p.aeroway === "terminal",
    layer: "TERMINAL",
  },
  {
    match: (p: Record<string, unknown>) => p.building !== undefined,
    layer: "BUILDING",
  },
  {
    match: (p: Record<string, unknown>) =>
      p.amenity === "parking" || p.amenity === "motorcycle_parking",
    layer: "PARKING",
  },
  {
    match: (p: Record<string, unknown>) =>
      p.natural === "water" || p.waterway !== undefined,
    layer: "WATER",
  },
  {
    match: (p: Record<string, unknown>) =>
      p.landuse === "grass" || p.natural === "grassland",
    layer: "GRASS",
  },
  {
    match: (p: Record<string, unknown>) =>
      (p.amenity !== undefined &&
        p.amenity !== "parking" &&
        p.amenity !== "motorcycle_parking") ||
      p.shop !== undefined ||
      p.office !== undefined ||
      p.tourism !== undefined,
    layer: "POINT_OF_INTEREST",
  },
  {
    match: (p: Record<string, unknown>) => p.aeroway === "aerodrome",
    layer: "AERODROME",
  },
  {
    match: (p: Record<string, unknown>) => p.highway !== undefined,
    layer: "ROAD",
  },
  {
    match: (p: Record<string, unknown>) => p.barrier !== undefined,
    layer: "BARRIER",
  },
  {
    match: (p: Record<string, unknown>) =>
      p.man_made === "tower" || p["tower:type"] !== undefined,
    layer: "WATCH_TOWER",
  },
  {
    match: (p: Record<string, unknown>) => p.landuse === "military",
    layer: "MILITARY",
  },
  {
    match: (p: Record<string, unknown>) => p.landuse === "garden",
    layer: "GARDEN",
  },
  {
    match: (_: Record<string, unknown>) => true,
    layer: "OTHER",
  },
];

/**
 * Resolve layer dari GeoJSON properties. Return null kalau tidak ada rule yang cocok
 * (layer tidak dikenali -> feature ditandai invalid oleh caller).
 */
export function resolveLayer(
  properties: Record<string, unknown> | null | undefined,
): LayerName | null {
  if (!properties) return null;
  for (const rule of LAYER_RULES) {
    if (rule.match(properties)) return rule.layer;
  }
  return null;
}
