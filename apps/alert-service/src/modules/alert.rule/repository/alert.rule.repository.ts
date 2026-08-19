import { type AlertRule, alertRules, db } from "@repo/database";
import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import type { ListAlertRulesInput } from "../validator/alert.rule.validator";

const SORTABLE_COLUMNS = {
  createdAt: alertRules.createdAt,
  updatedAt: alertRules.updatedAt,
  type: alertRules.type,
} as const;

export type AlertRuleSortableColumn = keyof typeof SORTABLE_COLUMNS;

const buildFilters = (params: ListAlertRulesInput): SQL | undefined => {
  const filters: (SQL | undefined)[] = [
    params.airportId ? eq(alertRules.airportId, params.airportId) : undefined,
    params.type ? eq(alertRules.type, params.type) : undefined,
    params.enabled !== undefined
      ? eq(alertRules.enabled, params.enabled)
      : undefined,
  ];

  const active = filters.filter(
    (filter): filter is SQL => filter !== undefined,
  );

  if (active.length === 0) return undefined;
  return active.length === 1 ? active[0] : and(...active);
};

export interface ListAlertRulesResult {
  items: AlertRule[];
  total: number;
}

export const listAlertRules = async (
  params: ListAlertRulesInput,
): Promise<ListAlertRulesResult> => {
  const where = buildFilters(params);
  const sortBy: AlertRuleSortableColumn =
    (params.sortBy as AlertRuleSortableColumn) ?? "createdAt";
  const column = SORTABLE_COLUMNS[sortBy] ?? alertRules.createdAt;
  const orderBy = params.sortOrder === "asc" ? asc(column) : desc(column);
  const offset = (params.page - 1) * params.limit;

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(alertRules)
      .where(where)
      .orderBy(orderBy)
      .limit(params.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(alertRules)
      .where(where),
  ]);

  return { items, total: totalRow[0]?.count ?? 0 };
};

export const findAlertRuleById = async (
  id: string,
): Promise<AlertRule | undefined> =>
  await db.query.alertRules.findFirst({ where: eq(alertRules.id, id) });

export const createAlertRule = async (
  values: Omit<AlertRule, "id" | "createdAt" | "updatedAt">,
): Promise<AlertRule> => {
  const [row] = await db.insert(alertRules).values(values).returning();
  return row;
};

export const updateAlertRule = async (
  id: string,
  values: Partial<Omit<AlertRule, "id" | "createdAt" | "updatedAt">>,
): Promise<AlertRule | undefined> => {
  const [row] = await db
    .update(alertRules)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(alertRules.id, id))
    .returning();
  return row;
};
