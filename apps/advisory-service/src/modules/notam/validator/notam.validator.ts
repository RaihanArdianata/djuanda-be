import { z } from "zod";

const SORT_BY_VALUES = [
  "effectiveFrom",
  "effectiveTo",
  "createdAt",
  "updatedAt",
] as const;

const NOTAM_STATUS_VALUES = ["ACTIVE", "CANCELLED", "EXPIRED"] as const;
const NOTAM_TYPE_VALUES = ["NOTAMN", "NOTAMR", "NOTAMC"] as const;

export const listNotamQuerySchema = z
  .object({
    status: z.enum(NOTAM_STATUS_VALUES).optional(),
    fir: z.string().trim().min(1).max(8).optional(),
    icaoLocation: z.string().trim().min(1).max(8).optional(),
    qcode: z.string().trim().min(1).max(16).optional(),
    series: z.string().trim().min(1).max(4).optional(),
    type: z.enum(NOTAM_TYPE_VALUES).optional(),
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

export type ListNotamQueryInput = z.infer<typeof listNotamQuerySchema>;
