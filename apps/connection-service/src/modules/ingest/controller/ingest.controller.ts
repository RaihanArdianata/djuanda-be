import { ApiError, catchAsync, success } from "@repo/shared";
import { z } from "zod";
import {
  AirportMismatchError,
  assertExpectedAirport,
  enqueueIngestEvent,
  getIngestEventIdentity,
  getIngestLogKind,
  isValidIngestSecret,
  recordIngestLog,
} from "../service/ingest.service";
import { ingestEnvelopeSchema } from "../validator/ingest.validator";

const UNKNOWN_EVENT_MESSAGE =
  "Unrecognized event shape — expected a FusedTrackEvent (trackId + fusedAt), AlertEvent (alertId + triggeredAt), or MovementEvent (trackId + type + at)";

function rejectUnknownEvent(source: "http" | "kafka", message: string): void {
  recordIngestLog({ source, kind: "unknown", status: "rejected", message });
}

export const ingest = catchAsync(async (c) => {
  if (!isValidIngestSecret(c.req.header("x-aero-ingest-secret"))) {
    rejectUnknownEvent(
      "http",
      "Invalid or missing x-aero-ingest-secret header",
    );
    throw new ApiError("INVALID_CREDENTIALS", {
      message: "Invalid or missing x-aero-ingest-secret header",
    });
  }

  const body = await c.req.json();
  const parsed = ingestEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    rejectUnknownEvent("http", "Ingest body validation failed");
    throw new ApiError("VALIDATION_ERROR", {
      fields: z.flattenError(parsed.error).fieldErrors,
    });
  }

  const { event } = parsed.data;
  const { id, airportId } = getIngestEventIdentity(event);
  const kind = getIngestLogKind(event);

  if (kind === "unknown") {
    rejectUnknownEvent("http", UNKNOWN_EVENT_MESSAGE);
    throw new ApiError("VALIDATION_ERROR", { message: UNKNOWN_EVENT_MESSAGE });
  }

  try {
    assertExpectedAirport(event as { airportId?: string });
  } catch (err) {
    if (err instanceof AirportMismatchError) {
      recordIngestLog({
        source: "http",
        kind,
        status: "rejected",
        id,
        airportId,
        message: err.message,
      });
      throw new ApiError("VALIDATION_ERROR", { message: err.message });
    }
    throw err;
  }

  await enqueueIngestEvent(event);
  recordIngestLog({ source: "http", kind, status: "accepted", id, airportId });
  return success(c, { kind }, { message: `${kind} event accepted` });
});
