import { createHash } from "node:crypto";
import type { NormalizedAshtamMessage } from "../parser/common";

/**
 * Unlike AFTN (which has no natural id and hashes the raw message to derive
 * one), ASHTAM already carries a natural identity via `msg_id`. Identity is
 * therefore simply `source + providerId` (enforced by a unique constraint in
 * the schema) — this hash is only used to tell UPDATE apart from NO-OP on a
 * repeated synchronization run.
 */
export const computeAshtamContentHash = (
  message: NormalizedAshtamMessage,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        message.type,
        message.providerId,
        message.number,
        message.header,
        message.affectedFir,
        message.effectiveFrom.toISOString(),
        message.effectiveTo.toISOString(),
        message.volcanoName,
        message.volcanoCoordinates,
        message.colourCode,
        message.volcanicAsh,
        message.volcanicAshDirection,
        message.airRoutesAffected,
        message.airRoutesClosure,
        message.informationSource,
        message.remark,
        message.raw,
      ]),
    )
    .digest("hex");
