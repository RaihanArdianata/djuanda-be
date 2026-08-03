import { LAYER_VALUES } from "@repo/database";
import z from "zod";

export const layerFilterSchema = z.object({
  name: z
    .enum(LAYER_VALUES)
    .optional()
    .describe(
      "Filter layers by name. If not provided, all layers will be returned.",
    ),
});

export type LayerFilter = z.infer<typeof layerFilterSchema>;
