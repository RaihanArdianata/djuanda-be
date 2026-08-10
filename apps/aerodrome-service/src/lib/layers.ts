import type { LayerName } from "@repo/database";

interface LayerRule {
  match: (props: Record<string, unknown>) => boolean;
  layer: LayerName;
}

// Mapping property -> layer sesuai tabel "Layer Mapping" di dokumen.
const LAYER_RULES: LayerRule[] = [
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
    match: (p: Record<string, unknown>) => p.amenity === "parking",
    layer: "PARKING",
  },
  {
    match: (p: Record<string, unknown>) => p.natural === "water",
    layer: "WATER",
  },
  {
    match: (p: Record<string, unknown>) => p.landuse === "grass",
    layer: "GRASS",
  },
  {
    match: (p: Record<string, unknown>) => p.tourism !== undefined,
    layer: "POINT_OF_INTEREST",
  },
  {
    match: (p: Record<string, unknown>) => p.aeroway === "aerodrome",
    layer: "AERODROME",
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
