import { logger } from "@repo/logger";
import ApiError from "@repo/shared/api-error";
import { success } from "@repo/shared/api-response";
import { catchAsync } from "@repo/shared/catch-async";
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

  // Fire-and-forget: the HTTP caller should not wait for the 500ms buffer
  // flush. Resolve 202 Accepted immediately once the event is enqueued; any
  // flush error is logged and the persisted ingest log reflects the queue.
  enqueueIngestEvent(event).catch((err) => {
    logger.error({ err, id, kind }, "http ingest: enqueue/flush failed");
    recordIngestLog({
      source: "http",
      kind,
      status: "error",
      id,
      airportId,
      message:
        err instanceof Error ? err.message : "enqueue/flush error after 202",
    });
  });

  recordIngestLog({ source: "http", kind, status: "accepted", id, airportId });
  return success(c, { kind }, { code: 202, message: "event enqueued" });
});
