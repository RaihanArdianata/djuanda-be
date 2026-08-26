import z from "zod";

const notamEventTypeSchema = z.enum(["NOTAM_RECEIVED", "NOTAM_UPDATED"]);

export const notamPublishQuerySchema = z.object({
  airportId: z.string().min(1),
});

export const notamPublishBodySchema = z.object({
  eventType: notamEventTypeSchema.default("NOTAM_UPDATED"),
});
