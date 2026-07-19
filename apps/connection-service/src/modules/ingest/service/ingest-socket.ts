import { logger } from "@repo/logger";
import {
  enqueueAlertEvent,
  enqueueTrackEvent,
  isAlertEvent,
  isTrackEvent,
} from "./ingest.service";

export function handleIngestSocketMessage(raw: string | Buffer): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch {
    return; // malformed frame — ignore, same policy as the replay socket
  }

  const event =
    parsed !== null && typeof parsed === "object" && "event" in parsed
      ? (parsed as { event: unknown; }).event
      : parsed;

  if (isTrackEvent(event)) {
    enqueueTrackEvent(event);
    return;
  }
  if (isAlertEvent(event)) {
    enqueueAlertEvent(event);
    return;
  }
  logger.warn({ keys: event && typeof event === "object" ? Object.keys(event) : typeof event }, "ws ingest: unrecognized event shape — dropped");
}
