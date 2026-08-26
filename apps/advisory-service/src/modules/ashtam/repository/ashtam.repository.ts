// NOTE: `db` should come from `@repo/database` (as `aftn.repository.ts` does)
// once `ashtam.schema.ts` is moved into that package — see the header comment
// in `../schema/ashtam.schema.ts` for details. Imported locally for now since
// that package's source wasn't part of this upload.
import { type AshtamMessage, ashtamMessages, db } from "@repo/database";
import { and, eq } from "drizzle-orm";
import type { NormalizedAshtamMessage } from "../parser/common";

import { computeAshtamContentHash } from "./ashtam.identity";

export type AshtamUpsertOutcome = "created" | "updated" | "unchanged";

export interface UpsertAshtamOptions {
  source: string;
  providerRaw: Record<string, unknown>;
}

/**
 * Upsert identity is `source + providerId` (unique constraint in the
 * schema). Behavior:
 *   - record doesn't exist            → INSERT (created)
 *   - record exists, content changed  → UPDATE (updated)
 *   - record exists, content same     → NO-OP  (unchanged)
 *
 * `status` is only set on INSERT (new ASHTAM = ACTIVE per spec) and is
 * deliberately left alone on UPDATE, so an operator-set CANCELLED/EXPIRED
 * status isn't silently overwritten by the next sync of the same message.
 */
export const upsertAshtamMessage = async (
  message: NormalizedAshtamMessage,
  options: UpsertAshtamOptions,
): Promise<AshtamUpsertOutcome> => {
  const contentHash = computeAshtamContentHash(message);

  const sharedValues = {
    type: message.type,
    number: message.number,
    header: message.header,
    affectedFir: message.affectedFir,
    effectiveFrom: message.effectiveFrom,
    effectiveTo: message.effectiveTo,
    volcanoName: message.volcanoName,
    volcanoCoordinates: message.volcanoCoordinates,
    colourCode: message.colourCode,
    volcanicAsh: message.volcanicAsh,
    volcanicAshDirection: message.volcanicAshDirection,
    airRoutesAffected: message.airRoutesAffected,
    airRoutesClosure: message.airRoutesClosure,
    informationSource: message.informationSource,
    remark: message.remark,
    contentHash,
    raw: message.raw,
    providerRaw: options.providerRaw,
  };

  const inserted = await db
    .insert(ashtamMessages)
    .values({
      source: options.source,
      providerId: message.providerId,
      status: "ACTIVE",
      ...sharedValues,
    })
    .onConflictDoNothing({
      target: [ashtamMessages.source, ashtamMessages.providerId],
    })
    .returning({ id: ashtamMessages.id });

  if (inserted.length > 0) {
    return "created";
  }

  const identityWhere = and(
    eq(ashtamMessages.source, options.source),
    eq(ashtamMessages.providerId, message.providerId),
  );

  const existing = await db
    .select({ contentHash: ashtamMessages.contentHash })
    .from(ashtamMessages)
    .where(identityWhere)
    .limit(1);

  if (existing[0]?.contentHash === contentHash) {
    return "unchanged";
  }

  await db
    .update(ashtamMessages)
    .set({ ...sharedValues, updatedAt: new Date() })
    .where(identityWhere);

  return "updated";
};

export const findAshtamByIdentity = async (
  source: string,
  providerId: string,
): Promise<AshtamMessage | undefined> =>
  await db.query.ashtamMessages.findFirst({
    where: and(
      eq(ashtamMessages.source, source),
      eq(ashtamMessages.providerId, providerId),
    ),
  });
