import { ApiError, catchAsync, success } from "@repo/shared";
import { z } from "zod";
import {
  AirportMismatchError,
  assertExpectedAirport,
  enqueueAlertEvent,
  enqueueMovementEvent,
  enqueueTrackEvent,
  isAlertEvent,
  isMovementEvent,
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

  if (isTrackEvent(event) || isAlertEvent(event) || isMovementEvent(event)) {
    try {
      assertExpectedAirport(event);
    } catch (err) {
      if (err instanceof AirportMismatchError) {
        throw new ApiError("VALIDATION_ERROR", { message: err.message });
      }
      throw err;
    }
  }

  if (isTrackEvent(event)) {
    await enqueueTrackEvent(event);
    return success(c, { kind: "track" }, { message: "Track event accepted" });
  }

  if (isAlertEvent(event)) {
    await enqueueAlertEvent(event);
    return success(c, { kind: "alert" }, { message: "Alert event accepted" });
  }

  if (isMovementEvent(event)) {
    await enqueueMovementEvent(event);
    return success(
      c,
      { kind: "movement" },
      { message: "Movement event accepted" },
    );
  }

  throw new ApiError("VALIDATION_ERROR", {
    message:
      "Unrecognized event shape — expected a FusedTrackEvent (trackId + fusedAt), AlertEvent (alertId + triggeredAt), or MovementEvent (trackId + type + at)",
  });
});
