import z from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
});

export const listAlertSchema = z.object({
  airportId: z.string().optional(),
  type: z.string().optional(),
  severity: z.string().optional(),
  status: z.string().optional(),
  trackId: z.string().optional(),
  relatedTrackId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  q: z.string().optional(),
  sortBy: z
    .enum([
      "triggeredAt",
      "createdAt",
      "updatedAt",
      "type",
      "severity",
      "status",
    ])
    .optional(),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const listAlertInputSchema = listAlertSchema.merge(paginationSchema);

export const acknowledgeAlertSchema = z.object({
  acknowledgedBy: z.string().optional(),
});

export const clearAlertSchema = z.object({
  clearedBy: z.string().optional(),
});

export const trackSchema = z.object({
  trackId: z.string(),
  airportId: z.string(),
  targetType: z.string().optional().default("AIRCRAFT"),
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  altitude: z.coerce.number().optional(),
  groundSpeed: z.coerce.number().optional(),
  heading: z.coerce.number().optional(),
  onGround: z.coerce.boolean().optional(),
  timestamp: z.coerce.date(),
  callsign: z.string().optional(),
  registration: z.string().optional(),
  aircraftType: z.string().optional(),
  vehicleFleet: z.string().optional(),
  lifecycle: z.string().optional(),
});

export const detectSchema = z.object({
  airportId: z.string(),
  timestamp: z.coerce.date().default(() => new Date()),
  tracks: z.array(trackSchema),
});

export type ListAlertsInput = z.infer<typeof listAlertInputSchema>;
export type AcknowledgeAlertInput = z.infer<typeof acknowledgeAlertSchema>;
export type ClearAlertInput = z.infer<typeof clearAlertSchema>;
export type DetectInput = z.infer<typeof detectSchema>;
