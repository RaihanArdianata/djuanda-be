import { ApiError, catchAsync, success } from "@repo/shared";
import { z } from "zod";
import {
  AirportMismatchError,
  assertExpectedAirport,
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

  if (isTrackEvent(event) || isAlertEvent(event)) {
    try {
      assertExpectedAirport(event);
    } catch (err) {
      if (err instanceof AirportMismatchError) {
        // 4xx, not 5xx: this is a permanent config mismatch (wrong
        // connector, wrong topic), not a transient failure — the sender's
        // WebhookSink only retries 5xx (see aeroswarm-project's
        // packages/server/connectors/src/outputs/webhook), so a 4xx skips
        // straight to its DLQ instead of wasting retries on something that
        // will never succeed. Still non-2xx, so it's not silently accepted.
        throw new ApiError("VALIDATION_ERROR", { message: err.message });
      }
      throw err;
    }
  }

  if (isTrackEvent(event)) {
    // Waits for this event's batch to actually land in Postgres before
    // acking — a flush failure rejects here and propagates as a 5xx (see
    // catchAsync), so the sender's retry/DLQ machinery sees it instead of
    // believing a dropped row was delivered.
    await enqueueTrackEvent(event);
    return success(c, { kind: "track" }, { message: "Track event accepted" });
  }

  if (isAlertEvent(event)) {
    await enqueueAlertEvent(event);
    return success(c, { kind: "alert" }, { message: "Alert event accepted" });
  }

  throw new ApiError("VALIDATION_ERROR", {
    message:
      "Unrecognized event shape — expected a FusedTrackEvent (trackId + fusedAt) or AlertEvent (alertId + triggeredAt)",
  });
});
