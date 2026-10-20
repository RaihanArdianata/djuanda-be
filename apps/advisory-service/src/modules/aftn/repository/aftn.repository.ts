import { type AftnMessage, aftnMessages, db } from "@repo/database";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  lte,
  type SQL,
  sql,
} from "drizzle-orm";
import type { NormalizedAftnMessage } from "../parser/common";
import type { ListAftnQueryInput } from "../validator/aftn.validator";
import { computeAftnContentHash, computeAftnProviderId } from "./aftn.identity";

export type UpsertOutcome = "created" | "updated" | "unchanged";

const SORTABLE_COLUMNS = {
  datetime: aftnMessages.datetime,
  messageType: aftnMessages.messageType,
  callSign: aftnMessages.callSign,
  registration: aftnMessages.registration,
  aircraftType: aftnMessages.aircraftType,
  departure: aftnMessages.departure,
  destination: aftnMessages.destination,
  createdAt: aftnMessages.createdAt,
} as const;

export type AftnSortableColumn = keyof typeof SORTABLE_COLUMNS;

export const upsertAftnMessage = async (
  message: NormalizedAftnMessage,
  options: { source: string; providerRaw: Record<string, unknown> },
): Promise<UpsertOutcome> => {
  const providerId = computeAftnProviderId(message, options.source);
  const contentHash = computeAftnContentHash(message);

  const values = {
    providerId,
    contentHash,
    datetime: message.datetime,
    messageType: message.messageType,
    callSign: message.callSign,
    registration: message.registration,
    aircraftType: message.aircraftType,
    departure: message.departure,
    departureTime: message.departureTime,
    destination: message.destination,
    destinationTime: message.destinationTime,
    duration: message.duration,
    speed: message.speed,
    altitude: message.altitude,
    route: message.route,
    raw: message.raw,
    parsed: message.parsed,
    providerRaw: options.providerRaw,
    source: options.source,
  };

  const inserted = await db
    .insert(aftnMessages)
    .values(values)
    .onConflictDoNothing({ target: aftnMessages.providerId })
    .returning({ id: aftnMessages.id });

  if (inserted.length > 0) {
    return "created";
  }

  const existing = await db
    .select({ contentHash: aftnMessages.contentHash })
    .from(aftnMessages)
    .where(eq(aftnMessages.providerId, providerId))
    .limit(1);

  if (existing[0]?.contentHash === contentHash) {
    return "unchanged";
  }

  await db
    .update(aftnMessages)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(aftnMessages.providerId, providerId));

  return "updated";
};

const buildFilters = (params: ListAftnQueryInput): SQL | undefined => {
  const filters: (SQL | undefined)[] = [
    params.messageType
      ? eq(aftnMessages.messageType, params.messageType.toUpperCase())
      : undefined,
    params.callSign
      ? ilike(aftnMessages.callSign, `%${params.callSign}%`)
      : undefined,
    params.registration
      ? ilike(aftnMessages.registration, `%${params.registration}%`)
      : undefined,
    params.aircraftType
      ? eq(aftnMessages.aircraftType, params.aircraftType.toUpperCase())
      : undefined,
    params.departure
      ? eq(aftnMessages.departure, params.departure.toUpperCase())
      : undefined,
    params.destination
      ? eq(aftnMessages.destination, params.destination.toUpperCase())
      : undefined,
    params.startDate ? gte(aftnMessages.datetime, params.startDate) : undefined,
    params.endDate ? lte(aftnMessages.datetime, params.endDate) : undefined,
  ];

  const active = filters.filter(
    (filter): filter is SQL => filter !== undefined,
  );

  if (active.length === 0) {
    return undefined;
  }

  return active.length === 1 ? active[0] : and(...active);
};

export interface ListAftnResult {
  items: AftnMessage[];
  total: number;
}

export const listAftnMessages = async (
  params: ListAftnQueryInput,
): Promise<ListAftnResult> => {
  const where = buildFilters(params);
  const column = SORTABLE_COLUMNS[params.sortBy];
  const orderBy = params.sortOrder === "asc" ? asc(column) : desc(column);
  const offset = (params.page - 1) * params.limit;

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(aftnMessages)
      .where(where)
      .orderBy(orderBy)
      .limit(params.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aftnMessages)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.count ?? 0 };
};

export const findAftnMessageById = async (
  id: string,
): Promise<AftnMessage | undefined> =>
  await db.query.aftnMessages.findFirst({ where: eq(aftnMessages.id, id) });

export const findRecentAftnMessagesByAircraft = async (
  by: "callSign" | "registration",
  value: string,
  limit = 20,
): Promise<AftnMessage[]> =>
  await db
    .select()
    .from(aftnMessages)
    .where(eq(aftnMessages[by], value.trim().toUpperCase()))
    .orderBy(desc(aftnMessages.datetime))
    .limit(limit);
