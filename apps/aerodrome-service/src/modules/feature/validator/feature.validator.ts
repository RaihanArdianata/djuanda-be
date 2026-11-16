import { FEATURE_STATUS_VALUES, LAYER_VALUES } from "@repo/database";
import z from "zod";

/** Warna fitur pilihan operator (Aerodrome Studio): #RRGGBB, dibaca peta Studio dan peta utama. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const geometrySchema = z.object({
  type: z.enum([
    "Point",
    "LineString",
    "Polygon",
    "MultiPoint",
    "MultiLineString",
    "MultiPolygon",
  ]),
  coordinates: z.any(),
});

export const createFeatureSchema = z.object({
  layer: z.enum(LAYER_VALUES),
  name: z.string().max(255).optional(),
  status: z.enum(FEATURE_STATUS_VALUES).optional(),
  geometry: geometrySchema,
  properties: z
    .record(z.string(), z.any())
    .default({})
    .refine((p) => p.color === undefined || HEX_COLOR.test(String(p.color)), {
      message: "properties.color harus berformat #RRGGBB",
      path: ["color"],
    }),
});

export const updateFeatureSchema = createFeatureSchema.partial();

export const listFeatureQuerySchema = z.object({
  layer: z.enum(LAYER_VALUES).optional(),
  airportId: z.string().max(255).optional(),
  status: z.enum(FEATURE_STATUS_VALUES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListFeatureQueryInput = z.infer<typeof listFeatureQuerySchema>;
export type CreateFeatureInput = z.infer<typeof createFeatureSchema>;
export type UpdateFeatureInput = z.infer<typeof updateFeatureSchema>;
