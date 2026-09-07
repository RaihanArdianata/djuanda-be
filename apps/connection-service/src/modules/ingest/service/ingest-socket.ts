import { logger } from "@repo/logger";
import {
  AirportMismatchError,
  assertExpectedAirport,
  enqueueAlertEvent,
  enqueueMovementEvent,
  enqueueTrackEvent,
  isAlertEvent,
  isMovementEvent,
  isTrackEvent,
} from "./ingest.service";

interface SendableSocket {
  send(data: string): void;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needed for the various event types and error handling
export function handleIngestSocketMessage(
  raw: string | Buffer,
  socket: SendableSocket,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    logger.warn({ raw: raw.toString() }, "ws ingest: invalid JSON");
    try {
      socket.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    } catch {
      /* socket already closing — nothing to notify */
    }
    return;
  }

  const event =
    parsed !== null && typeof parsed === "object" && "event" in parsed
      ? (parsed as { event: unknown }).event
      : parsed;

  if (isTrackEvent(event) || isAlertEvent(event) || isMovementEvent(event)) {
    try {
      assertExpectedAirport(event);
    } catch (err) {
      if (err instanceof AirportMismatchError) {
        logger.error(
          {
            err,
            trackId: (event as { trackId?: string }).trackId,
            alertId: (event as { alertId?: string }).alertId,
          },
          "ws ingest: airport mismatch — event dropped",
        );
        try {
          socket.send(JSON.stringify({ type: "error", message: err.message }));
        } catch {
          /* socket already closing — nothing to notify */
        }
        return;
      }
      throw err;
    }
  }

  if (isTrackEvent(event)) {
    enqueueTrackEvent(event);
    return;
  }
  if (isAlertEvent(event)) {
    enqueueAlertEvent(event);
    return;
  }
  if (isMovementEvent(event)) {
    enqueueMovementEvent(event);
    return;
  }
  logger.warn(
    {
      keys:
        event && typeof event === "object" ? Object.keys(event) : typeof event,
    },
    "ws ingest: unrecognized event shape — dropped",
  );
}
