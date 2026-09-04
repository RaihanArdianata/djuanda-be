import { z } from "zod";
export const MOVEMENT_TYPE_VALUES = ["TAKE_OFF", "LANDING"] as const;
export type MovementApiType = (typeof MOVEMENT_TYPE_VALUES)[number];

export const getMovementsSchema = z
  .object({
    type: z.enum(MOVEMENT_TYPE_VALUES).optional(),
    airportId: z.string().min(1).optional(),
    startDateTime: z.coerce.date().optional(),
    endDateTime: z.coerce.date().optional(),
  })
  .refine(
    (v) =>
      !(v.startDateTime && v.endDateTime) || v.startDateTime <= v.endDateTime,
    {
      message: "startDateTime must be before or equal to endDateTime",
      path: ["startDateTime"],
    },
  );

export type GetMovementsParams = z.infer<typeof getMovementsSchema>;
