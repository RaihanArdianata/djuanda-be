import { createHash } from "node:crypto";
import type { NormalizedAftnMessage } from "../parser/common";

export const computeAftnProviderId = (
  message: NormalizedAftnMessage,
  source: string,
): string => {
  const canonicalRaw = message.raw.replace(/\s+/g, " ").trim().toUpperCase();

  return createHash("sha256")
    .update(
      [
        source,
        message.messageType,
        message.datetime.toISOString(),
        canonicalRaw,
      ].join("|"),
    )
    .digest("hex");
};

export const computeAftnContentHash = (
  message: NormalizedAftnMessage,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        message.messageType,
        message.datetime.toISOString(),
        message.callSign,
        message.registration,
        message.aircraftType,
        message.departure,
        message.departureTime,
        message.destination,
        message.destinationTime,
        message.duration,
        message.speed,
        message.altitude,
        message.route,
        message.raw,
        message.parsed,
      ]),
    )
    .digest("hex");
