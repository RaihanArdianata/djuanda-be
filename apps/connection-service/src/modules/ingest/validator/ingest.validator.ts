import { z } from "zod";

// AeroSwarm's http (webhook) connector delivers ONE event per POST as
// { event, timestamp } — see aeroswarm-project's
// packages/server/connectors/src/outputs/webhook. Track vs alert is
// distinguished by shape (see isTrackEvent/isAlertEvent in the service),
// not by a type field, so the envelope only pins down the wrapper here.
export const ingestEnvelopeSchema = z.object({
  event: z.record(z.string(), z.unknown()),
  timestamp: z.number().optional(),
});
