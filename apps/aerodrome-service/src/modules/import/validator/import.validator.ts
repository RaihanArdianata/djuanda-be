import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { geometrySchema } from "../../feature/validator/feature.validator";
import { LAYER_VALUES } from "@repo/database";

extendZodWithOpenApi(z);

export const updatePreviewFeatureSchema = z.object({
  layer: z.enum(LAYER_VALUES).optional(),
  geometry: geometrySchema.optional(),
  properties: z.record(z.string(), z.any()).optional(),
});

export const addPreviewFeatureSchema = z.object({
  layer: z.enum(LAYER_VALUES).optional(), // kalau tidak diisi, coba di-infer dari properties
  geometry: geometrySchema,
  properties: z.record(z.string(), z.any()).default({}),
});

export type UpdatePreviewFeatureInput = z.infer<
  typeof updatePreviewFeatureSchema
>;
export type AddPreviewFeatureInput = z.infer<typeof addPreviewFeatureSchema>;

export const importSessionSchema = z.object({
  file: z.instanceof(File).openapi({
    type: "string",
    format: "binary",
    description: "GeoJSON file to import",
  }),
  mode: z.enum(["APPEND", "REPLACE"]),
});
export type ImportSessionInput = z.infer<typeof importSessionSchema>;
