import z from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  size: z.coerce.number().min(1).max(100).default(10),
});

export const getAlertSchema = z.object({
  airportId: z.string().optional(),
});

export type GetAlertSchemaType = z.infer<typeof getAlertSchema>;
export type PaginationSchemaType = z.infer<typeof paginationSchema>;
export type GetAllAlertsSchemaType = GetAlertSchemaType & PaginationSchemaType;
