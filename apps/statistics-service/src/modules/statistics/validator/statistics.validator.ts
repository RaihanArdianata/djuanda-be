import { z } from "zod";
import {
  DATE_ONLY_PATTERN,
  isValidCalendarDate,
  PERIOD_VALUES,
} from "../lib/period";

const dateOnlySchema = z
  .string()
  .regex(DATE_ONLY_PATTERN, "Date must use YYYY-MM-DD format")
  .refine(isValidCalendarDate, "Date must use YYYY-MM-DD format");

export const getOperationalStatisticsSchema = z.object({
  period: z.enum(PERIOD_VALUES),
  startDate: dateOnlySchema,
  endDate: dateOnlySchema,
  airportId: z.string().min(1).optional(),
});

export type GetOperationalStatisticsParams = z.infer<
  typeof getOperationalStatisticsSchema
>;
