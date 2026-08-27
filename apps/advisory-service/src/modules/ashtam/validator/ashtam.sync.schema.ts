import z from "zod";

/**
 * Mirrors `notamFetchBodySchema` (`notam.fetch.schema.ts`) — both ASHTAM
 * and NOTAM manual-sync bodies use snake_case `start_date` / `end_date`.
 * AFTN's own `/advisory/aftn/sync` endpoint predates this convention and
 * uses camelCase `startDate`/`endDate`; it is left untouched since it is
 * outside the scope of this change.
 */
export const ashtamSyncBodySchema = z.object({
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});

export type AshtamSyncBodyInput = z.infer<typeof ashtamSyncBodySchema>;
