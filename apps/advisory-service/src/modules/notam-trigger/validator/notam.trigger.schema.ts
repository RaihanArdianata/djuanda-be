import z from "zod";

export const triggerNotamQuerySchema = z.object({
  airportId: z.string().min(1),
});

const notamItemSchema = z.record(z.string(), z.unknown());

export const triggerNotamBodySchema = z.union([
  notamItemSchema,
  z.array(notamItemSchema),
]);
