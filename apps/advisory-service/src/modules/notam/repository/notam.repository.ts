import { db, type NotamMessage, notamMessages } from "@repo/database";
import { and, eq, max } from "drizzle-orm";
import type { NormalizedNotamMessage } from "../parser/common";
import { computeNotamContentHash } from "./notam.identity";

export type NotamUpsertOutcome = "created" | "updated" | "unchanged";

export interface UpsertNotamOptions {
  source: string;
}

export const upsertNotamMessage = async (
  message: NormalizedNotamMessage,
  options: UpsertNotamOptions,
): Promise<NotamUpsertOutcome> => {
  const contentHash = computeNotamContentHash(message);

  const sharedValues = {
    providerId: message.providerId,
    header: message.header,
    type: message.type,
    fir: message.fir,
    icaoLocation: message.icaoLocation,
    qcode: message.qcode,
    traffic: message.traffic,
    purpose: message.purpose,
    scope: message.scope,
    lowerLimit: message.lowerLimit,
    upperLimit: message.upperLimit,
    coordinates: message.coordinates,
    effectiveFrom: message.effectiveFrom,
    effectiveTo: message.effectiveTo,
    schedule: message.schedule,
    lowerAltitude: message.lowerAltitude,
    upperAltitude: message.upperAltitude,
    subject: message.subject,
    body: message.body,
    contentHash,
    raw:
      typeof message.raw === "string"
        ? message.raw
        : JSON.stringify(message.raw),
  };

  const inserted = await db
    .insert(notamMessages)
    .values({
      source: options.source,
      series: message.series,
      number: message.number,
      year: message.year,
      status: "ACTIVE",
      ...sharedValues,
    })
    .onConflictDoNothing({
      target: [
        notamMessages.source,
        notamMessages.series,
        notamMessages.number,
        notamMessages.year,
      ],
    })
    .returning({ id: notamMessages.id });

  if (inserted.length > 0) {
    return "created";
  }

  const identityWhere = and(
    eq(notamMessages.source, options.source),
    eq(notamMessages.series, message.series),
    eq(notamMessages.number, message.number),
    eq(notamMessages.year, message.year),
  );

  const existing = await db
    .select({ contentHash: notamMessages.contentHash })
    .from(notamMessages)
    .where(identityWhere)
    .limit(1);

  if (existing[0]?.contentHash === contentHash) {
    return "unchanged";
  }

  await db
    .update(notamMessages)
    .set({ ...sharedValues, updatedAt: new Date() })
    .where(identityWhere);

  return "updated";
};

export const findNotamByIdentity = async (
  source: string,
  series: string,
  number: string,
  year: number,
): Promise<NotamMessage | undefined> =>
  await db.query.notamMessages.findFirst({
    where: and(
      eq(notamMessages.source, source),
      eq(notamMessages.series, series),
      eq(notamMessages.number, number),
      eq(notamMessages.year, year),
    ),
  });

export const findLatestNotamDatetime = async (): Promise<Date | null> => {
  const [row] = await db
    .select({ latest: max(notamMessages.effectiveFrom) })
    .from(notamMessages);

  return row?.latest ?? null;
};
