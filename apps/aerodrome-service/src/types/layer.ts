import { LAYER_VALUES } from "@repo/database";
import z from "zod";

export const layerSchema = z.object({
  layer: z.enum(LAYER_VALUES).describe("The name of the layer"),
  featureCount: z.number().int().nonnegative(),
});

export type Layer = z.infer<typeof layerSchema>;
