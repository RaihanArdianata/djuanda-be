import { db, type NotamMessage, notamMessages } from "@repo/database";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  like,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { ListNotamQueryInput } from "../validator/notam.validator";

const SORTABLE_COLUMNS = {
  effectiveFrom: notamMessages.effectiveFrom,
  effectiveTo: notamMessages.effectiveTo,
  createdAt: notamMessages.createdAt,
  updatedAt: notamMessages.updatedAt,
} as const;

export type NotamSortableColumn = keyof typeof SORTABLE_COLUMNS;

const buildPhaseFilter = (phase: string, now: Date): SQL | undefined => {
  switch (phase) {
    case "dibatalkan":
      return eq(notamMessages.status, "CANCELLED");
    case "kedaluwarsa":
      return or(
        eq(notamMessages.status, "EXPIRED"),
        and(
          eq(notamMessages.status, "ACTIVE"),
          lt(notamMessages.effectiveTo, now),
        ),
      );
    case "akan-datang":
      return and(
        eq(notamMessages.status, "ACTIVE"),
        gt(notamMessages.effectiveFrom, now),
      );
    case "berlaku":
      return and(
        eq(notamMessages.status, "ACTIVE"),
        lte(notamMessages.effectiveFrom, now),
        gte(notamMessages.effectiveTo, now),
      );
    default:
      return undefined;
  }
};

const buildFilters = (params: ListNotamQueryInput): SQL | undefined => {
  const now = new Date();
  const filters: (SQL | undefined)[] = [
    params.status ? eq(notamMessages.status, params.status) : undefined,
    params.phase ? buildPhaseFilter(params.phase, now) : undefined,
    params.fir ? eq(notamMessages.fir, params.fir.toUpperCase()) : undefined,
    params.icaoLocation
      ? eq(notamMessages.icaoLocation, params.icaoLocation.toUpperCase())
      : undefined,
    params.qcode
      ? like(notamMessages.qcode, `${params.qcode.toUpperCase()}%`)
      : undefined,
    params.series
      ? eq(notamMessages.series, params.series.toUpperCase())
      : undefined,
    params.type ? eq(notamMessages.type, params.type) : undefined,
    params.effectiveFrom
      ? gte(notamMessages.effectiveFrom, params.effectiveFrom)
      : undefined,
    params.effectiveTo
      ? lte(notamMessages.effectiveTo, params.effectiveTo)
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

export interface ListNotamResult {
  items: NotamMessage[];
  total: number;
}

export const listNotamMessages = async (
  params: ListNotamQueryInput,
): Promise<ListNotamResult> => {
  const where = buildFilters(params);
  const column = SORTABLE_COLUMNS[params.sortBy];
  const orderBy = params.sortOrder === "asc" ? asc(column) : desc(column);
  const offset = (params.page - 1) * params.limit;

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(notamMessages)
      .where(where)
      .orderBy(orderBy)
      .limit(params.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(notamMessages)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.count ?? 0 };
};
