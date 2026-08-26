import z from "zod";

export const notamFetchQuerySchema = z.object({
  airportId: z.string().min(1),
});

export const notamFetchBodySchema = z.object({
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});
