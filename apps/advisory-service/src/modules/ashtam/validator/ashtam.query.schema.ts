import { z } from "zod";

const SORT_BY_VALUES = [
  "effectiveFrom",
  "effectiveTo",
  "colourCode",
  "createdAt",
  "updatedAt",
] as const;

const ASHTAM_STATUS_VALUES = ["ACTIVE", "CANCELLED", "EXPIRED"] as const;

export const listAshtamQuerySchema = z
  .object({
    status: z.enum(ASHTAM_STATUS_VALUES).optional(),
    affectedFir: z.string().trim().min(1).max(8).optional(),
    volcanoName: z.string().trim().min(1).max(64).optional(),
    colourCode: z.string().trim().min(1).max(16).optional(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(20),
    sortBy: z.enum(SORT_BY_VALUES).default("effectiveFrom"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine(
    (value) =>
      !value.effectiveFrom ||
      !value.effectiveTo ||
      value.effectiveFrom <= value.effectiveTo,
    {
      message: "effectiveFrom harus lebih awal dari effectiveTo",
      path: ["effectiveFrom"],
    },
  );

export type ListAshtamQueryInput = z.infer<typeof listAshtamQuerySchema>;
