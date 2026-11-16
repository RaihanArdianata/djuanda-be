import { z } from "zod";

export const getCurrentObservationSchema = z.object({
  station: z.string().length(4).optional(),
});

export type GetCurrentObservationParams = z.infer<
  typeof getCurrentObservationSchema
>;

export const getForecastSchema = z.object({
  station: z.string().length(4).optional(),
});

export type GetForecastParams = z.infer<typeof getForecastSchema>;

export const getObservationHistorySchema = z
  .object({
    station: z.string().length(4).optional(),
    kind: z.union([z.literal("METAR"), z.literal("SPECI")]).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().min(1).default(1),
    size: z.coerce.number().min(1).max(100).default(10),
  })
  .refine((params) => !params.from || !params.to || params.from <= params.to, {
    message: "from must be before or equal to to",
    path: ["from"],
  });

export type GetObservationHistoryParams = z.infer<
  typeof getObservationHistorySchema
>;
