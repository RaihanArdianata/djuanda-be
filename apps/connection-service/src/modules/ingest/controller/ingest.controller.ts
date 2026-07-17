import { ApiError, catchAsync, success } from "@repo/shared";
import { z } from "zod";
import {
  enqueueAlertEvent,
  enqueueTrackEvent,
  isAlertEvent,
  isTrackEvent,
} from "../service/ingest.service";
import { ingestEnvelopeSchema } from "../validator/ingest.validator";

const INGEST_SECRET = process.env.AEROSWARM_INGEST_SECRET || "";

export const ingest = catchAsync(async (c) => {
  // Shared secret carried as a custom header on AeroSwarm's http connector
  // (config.headers) — without it anyone who can reach this port could
  // inject fake surveillance data.
  if (!INGEST_SECRET || c.req.header("x-aero-ingest-secret") !== INGEST_SECRET) {
    throw new ApiError("INVALID_CREDENTIALS", {
      message: "Invalid or missing x-aero-ingest-secret header",
    });
  }

  const body = await c.req.json();
  const parsed = ingestEnvelopeSchema.safeParse(body);

  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    throw new ApiError("VALIDATION_ERROR", { fields: fieldErrors });
  }

  const { event } = parsed.data;

  if (isTrackEvent(event)) {
    enqueueTrackEvent(event);
    return success(c, { kind: "track" }, { message: "Track event accepted" });
  }

  if (isAlertEvent(event)) {
    enqueueAlertEvent(event);
    return success(c, { kind: "alert" }, { message: "Alert event accepted" });
  }

  throw new ApiError("VALIDATION_ERROR", {
    message:
      "Unrecognized event shape — expected a FusedTrackEvent (trackId + fusedAt) or AlertEvent (alertId + triggeredAt)",
  });
});
