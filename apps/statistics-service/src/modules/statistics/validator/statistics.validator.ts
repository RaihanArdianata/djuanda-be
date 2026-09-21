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

export const TIME_ONLY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOnlySchema = z
  .string()
  .regex(TIME_ONLY_PATTERN, "Time must use HH:mm format (00:00-23:59)");

export const getOperationalStatisticsSchema = z
  .object({
    period: z.enum(PERIOD_VALUES),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
    airportId: z.string().min(1).optional(),
    severity: z.string().trim().min(1).optional(),
    startTime: timeOnlySchema.optional(),
    endTime: timeOnlySchema.optional(),
  })
  .refine(
    (data) => (data.startTime === undefined) === (data.endTime === undefined),
    {
      message: "startTime and endTime must be provided together",
      path: ["startTime"],
    },
  )
  .refine(
    (data) => !data.startTime || !data.endTime || data.startTime < data.endTime,
    {
      message: "startTime must be earlier than endTime",
      path: ["endTime"],
    },
  );
export type GetOperationalStatisticsParams = z.infer<
  typeof getOperationalStatisticsSchema
>;
