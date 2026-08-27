// NOTE: `db` should come from `@repo/database` (as `aftn.repository.ts` does)
// once `ashtam.schema.ts` is moved into that package — see the header comment
// in `../schema/ashtam.schema.ts` for details. Imported locally for now since
// that package's source wasn't part of this upload.
import { type AshtamMessage, ashtamMessages, db } from "@repo/database";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  lte,
  max,
  type SQL,
  sql,
} from "drizzle-orm";
import type { NormalizedAshtamMessage } from "../parser/common";
import type { ListAshtamQueryInput } from "../validator/ashtam.query.schema";

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
export const findLatestAshtamDatetime = async (): Promise<Date | null> => {
  const [row] = await db
    .select({ latest: max(ashtamMessages.effectiveFrom) })
    .from(ashtamMessages);

  return row?.latest ?? null;
};

/** Mirrors `SORTABLE_COLUMNS` in `aftn.repository.ts`. */
const SORTABLE_COLUMNS = {
  effectiveFrom: ashtamMessages.effectiveFrom,
  effectiveTo: ashtamMessages.effectiveTo,
  colourCode: ashtamMessages.colourCode,
  createdAt: ashtamMessages.createdAt,
  updatedAt: ashtamMessages.updatedAt,
} as const;

export type AshtamSortableColumn = keyof typeof SORTABLE_COLUMNS;

/** Mirrors `buildFilters` in `aftn.repository.ts`, adapted to ASHTAM's own
 * filterable fields (see "Query" section of BE-ASHTAM.pdf). `affectedFir`
 * and `colourCode` are categorical codes (e.g. "WAAF", "ORANGE") so they're
 * matched exactly (case-insensitive); `volcanoName` is matched as a
 * case-insensitive partial, same as `callSign`/`registration` for AFTN. */
const buildFilters = (params: ListAshtamQueryInput): SQL | undefined => {
  const filters: (SQL | undefined)[] = [
    params.status ? eq(ashtamMessages.status, params.status) : undefined,
    params.affectedFir
      ? eq(ashtamMessages.affectedFir, params.affectedFir.toUpperCase())
      : undefined,
    params.volcanoName
      ? ilike(ashtamMessages.volcanoName, `%${params.volcanoName}%`)
      : undefined,
    params.colourCode
      ? eq(ashtamMessages.colourCode, params.colourCode.toUpperCase())
      : undefined,
    params.effectiveFrom
      ? gte(ashtamMessages.effectiveFrom, params.effectiveFrom)
      : undefined,
    params.effectiveTo
      ? lte(ashtamMessages.effectiveTo, params.effectiveTo)
      : undefined,
  ];

  const active = filters.filter(
    (filter): filter is SQL => filter !== undefined,
  );

  if (active.length === 0) {
    return undefined;
  }

  return active.length === 1 ? active[0] : and(...active);
};

export interface ListAshtamResult {
  items: AshtamMessage[];
  total: number;
}

/** Mirrors `listAftnMessages` in `aftn.repository.ts` — filter + sort +
 * paginate against the local `ashtamMessages` table (the data synced from
 * the real provider), not the legacy NAVSIM histories proxy. */
export const listAshtamMessages = async (
  params: ListAshtamQueryInput,
): Promise<ListAshtamResult> => {
  const where = buildFilters(params);
  const column = SORTABLE_COLUMNS[params.sortBy];
  const orderBy = params.sortOrder === "asc" ? asc(column) : desc(column);
  const offset = (params.page - 1) * params.limit;

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(ashtamMessages)
      .where(where)
      .orderBy(orderBy)
      .limit(params.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ashtamMessages)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.count ?? 0 };
};

export const findAshtamMessageById = async (
  id: string,
): Promise<AshtamMessage | undefined> =>
  await db.query.ashtamMessages.findFirst({
    where: eq(ashtamMessages.id, id),
  });

/**
 * Per BE-ASHTAM.pdf ("Active ASHTAM"): status = ACTIVE *and* not yet past
 * `effectiveTo`. Filtering on `effectiveTo` here (rather than relying only
 * on `status`) means this stays correct even before an expiry scheduler
 * exists to flip stale rows to EXPIRED — frontend never has to filter
 * expiry itself, per spec ("Frontend tidak perlu melakukan filtering
 * expiry sendiri").
 */
export const listActiveAshtamMessages = async (
  now: Date = new Date(),
): Promise<AshtamMessage[]> =>
  await db
    .select()
    .from(ashtamMessages)
    .where(
      and(
        eq(ashtamMessages.status, "ACTIVE"),
        gte(ashtamMessages.effectiveTo, now),
      ),
    )
    .orderBy(asc(ashtamMessages.effectiveTo));
