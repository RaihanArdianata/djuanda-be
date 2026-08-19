import z from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
});

export const listAlertRuleSchema = z.object({
  airportId: z.string().optional(),
  type: z.string().optional(),
  enabled: z.coerce.boolean().optional(),
  sortBy: z.enum(["createdAt", "updatedAt", "type"]).optional(),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const listAlertRuleInputSchema =
  listAlertRuleSchema.merge(paginationSchema);

export const createAlertRuleSchema = z.object({
  airportId: z.string().min(1),
  type: z.string().min(1),
  enabled: z.coerce.boolean().default(true),
  configuration: z.record(z.string(), z.unknown()).default({}),
});

export const updateAlertRuleSchema = z.object({
  enabled: z.coerce.boolean().optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});

export type ListAlertRulesInput = z.infer<typeof listAlertRuleInputSchema>;
export type CreateAlertRuleInput = z.infer<typeof createAlertRuleSchema>;
export type UpdateAlertRuleInput = z.infer<typeof updateAlertRuleSchema>;
