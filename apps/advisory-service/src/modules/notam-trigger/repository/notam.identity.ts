import { createHash } from "node:crypto";
import type { NormalizedNotamMessage } from "../parser/common";

export const computeNotamContentHash = (
  message: NormalizedNotamMessage,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        message.providerId,
        message.header,
        message.type,
        message.fir,
        message.icaoLocation,
        message.qcode,
        message.traffic,
        message.purpose,
        message.scope,
        message.lowerLimit,
        message.upperLimit,
        message.coordinates,
        message.effectiveFrom.toISOString(),
        message.effectiveTo.toISOString(),
        message.schedule,
        message.lowerAltitude,
        message.upperAltitude,
        message.subject,
        message.body,
        message.raw,
      ]),
    )
    .digest("hex");
