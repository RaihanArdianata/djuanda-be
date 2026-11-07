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
  verificationStatus: z
    .enum(["UNVERIFIED", "VERIFIED", "FALSE_ALARM"])
    .optional(),
  clearedBy: z.string().optional(),
  verifiedBy: z.string().optional(),
  includeDeleted: z.coerce.boolean().optional().default(false),
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
      "verificationStatus",
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
  reason: z.string().max(500).optional(),
  note: z.string().max(500).optional(),
});

export const bulkClearAlertSchema = z.object({
  alertIds: z
    .array(z.string().min(1, "Alert ID cannot be empty"))
    .min(1, "At least one alert ID is required")
    .max(100, "Maximum 100 alerts per bulk request"),
  clearedBy: z.string().optional(),
  reason: z.string().max(500).optional(),
});

export const verifyAlertSchema = z.object({
  status: z.enum(["VERIFIED", "FALSE_ALARM", "UNVERIFIED"]),
  note: z.string().max(500).optional(),
  verifiedBy: z.string().optional(),
});

export const deleteAlertSchema = z.object({
  deletedBy: z.string().optional(),
  reason: z.string().max(500).optional(),
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
export type BulkClearAlertInput = z.infer<typeof bulkClearAlertSchema>;
export type VerifyAlertInput = z.infer<typeof verifyAlertSchema>;
export type DeleteAlertInput = z.infer<typeof deleteAlertSchema>;
export type DetectInput = z.infer<typeof detectSchema>;

export const exportAlertSchema = z
  .object({
    format: z.enum(["csv", "xlsx"]),
    startDateTime: z.coerce.date(),
    endDateTime: z.coerce.date(),
    airportId: z.string().optional(),
    alertType: z.string().optional(),
    type: z.string().optional(),
    severity: z.string().optional(),
    status: z.string().optional(),
    trackId: z.string().optional(),
  })
  .refine((data) => data.startDateTime < data.endDateTime, {
    message: "Start date must be before end date",
    path: ["startDateTime"],
  });

export type ExportAlertInput = z.infer<typeof exportAlertSchema>;
