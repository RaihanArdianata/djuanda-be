import { ApiError, catchAsync, success } from "@repo/shared";
import { z } from "zod";
import {
  enqueueAlertEvent,
  enqueueTrackEvent,
  isAlertEvent,
  isTrackEvent,
  isValidIngestSecret,
} from "../service/ingest.service";
import { ingestEnvelopeSchema } from "../validator/ingest.validator";

export const ingest = catchAsync(async (c) => {
  if (!isValidIngestSecret(c.req.header("x-aero-ingest-secret"))) {
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
