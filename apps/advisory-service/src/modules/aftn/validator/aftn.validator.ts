import { z } from "zod";

const SORT_BY_VALUES = [
  "datetime",
  "messageType",
  "callSign",
  "registration",
  "aircraftType",
  "departure",
  "destination",
  "createdAt",
] as const;

const icao = z
  .string()
  .trim()
  .min(1)
  .max(8)
  .regex(/^[A-Za-z0-9]+$/, "hanya huruf dan angka");

export const listAftnQuerySchema = z
  .object({
    messageType: z
      .string()
      .trim()
      .min(2)
      .max(8)
      .regex(/^[A-Za-z]+$/, "message type hanya huruf")
      .optional(),
    callSign: z.string().trim().min(1).max(16).optional(),
    registration: z.string().trim().min(1).max(16).optional(),
    aircraftType: z.string().trim().min(1).max(8).optional(),
    departure: icao.optional(),
    destination: icao.optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(20),
    sortBy: z.enum(SORT_BY_VALUES).default("datetime"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine(
    (value) =>
      !value.startDate || !value.endDate || value.startDate <= value.endDate,
    { message: "startDate harus lebih awal dari endDate", path: ["startDate"] },
  );

export type ListAftnQueryInput = z.infer<typeof listAftnQuerySchema>;

export const latestAftnQuerySchema = z
  .object({
    callSign: z.string().trim().min(1).max(16).optional(),
    registration: z.string().trim().min(1).max(16).optional(),
  })
  .refine((value) => value.callSign || value.registration, {
    message: "callSign atau registration wajib diisi",
    path: ["callSign"],
  });

export type LatestAftnQueryInput = z.infer<typeof latestAftnQuerySchema>;
