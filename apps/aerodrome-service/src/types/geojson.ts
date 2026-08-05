import z from "zod";

export const GeoJsonPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]),
});

export const GeoJsonMultiPointSchema = z.object({
  type: z.literal("MultiPoint"),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

export const GeoJsonLineStringSchema = z.object({
  type: z.literal("LineString"),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
});

export const GeoJsonMultiLineStringSchema = z.object({
  type: z.literal("MultiLineString"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
});

export const GeoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))), // Array of LinearRings
});

export const GeoJsonMultiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(z.tuple([z.number(), z.number()])))), // Array of Polygons
});

export const GeoJsonFeatureSchema = z.object({
  type: z.literal("Feature"),
  id: z.string(),
  geometry: z.union([
    GeoJsonPointSchema,
    GeoJsonMultiPointSchema,
    GeoJsonLineStringSchema,
    GeoJsonMultiLineStringSchema,
    GeoJsonPolygonSchema,
    GeoJsonMultiPolygonSchema,
  ]),
  properties: z.record(z.string(), z.any()),
});

export const GeoJsonSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(GeoJsonFeatureSchema),
});

export interface GeoJson<T extends GeoJsonGeometry = GeoJsonGeometry> {
  type: "FeatureCollection";
  features: GeoJsonFeature<T>[];
}

export interface GeoJsonFeature<T extends GeoJsonGeometry = GeoJsonGeometry> {
  type: "Feature";
  id: string;
  geometry: T;
  properties: Record<string, unknown>;
}

export type GeoJsonGeometry =
  | GeoJsonPoint
  | GeoJsonMultiPoint
  | GeoJsonLineString
  | GeoJsonMultiLineString
  | GeoJsonPolygon
  | GeoJsonMultiPolygon;

export interface GeoJsonPoint {
  type: "Point";
  coordinates: [number, number];
}

export interface GeoJsonMultiPoint {
  type: "MultiPoint";
  coordinates: [number, number][];
}

export interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

export interface GeoJsonMultiLineString {
  type: "MultiLineString";
  coordinates: [number, number][][];
}

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: [number, number][][]; // Array of LinearRings
}

export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: [number, number][][][]; // Array of Polygons
}
