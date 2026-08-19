import { type Alert, alerts, db } from "@repo/database";
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
import type { ListAlertsInput } from "../validator/alert.validator";

const SORTABLE_COLUMNS = {
  triggeredAt: alerts.triggeredAt,
  createdAt: alerts.createdAt,
  updatedAt: alerts.updatedAt,
  type: alerts.type,
  severity: alerts.severity,
  status: alerts.status,
} as const;

export type AlertSortableColumn = keyof typeof SORTABLE_COLUMNS;

const buildFilters = (params: ListAlertsInput): SQL | undefined => {
  const filters: (SQL | undefined)[] = [
    params.airportId ? eq(alerts.airportId, params.airportId) : undefined,
    params.type ? eq(alerts.type, params.type) : undefined,
    params.severity ? eq(alerts.severity, params.severity) : undefined,
    params.status ? eq(alerts.status, params.status) : undefined,
    params.trackId ? eq(alerts.trackId, params.trackId) : undefined,
    params.relatedTrackId
      ? eq(alerts.relatedTrackId, params.relatedTrackId)
      : undefined,
    params.startDate ? gte(alerts.triggeredAt, params.startDate) : undefined,
    params.endDate ? lte(alerts.triggeredAt, params.endDate) : undefined,
    params.q ? ilike(alerts.alertId, `%${params.q}%`) : undefined,
  ];

  const active = filters.filter(
    (filter): filter is SQL => filter !== undefined,
  );

  if (active.length === 0) return undefined;
  return active.length === 1 ? active[0] : and(...active);
};

export interface ListAlertsResult {
  items: Alert[];
  total: number;
}

export const listAlerts = async (
  params: ListAlertsInput,
): Promise<ListAlertsResult> => {
  const where = buildFilters(params);
  const sortBy: AlertSortableColumn =
    (params.sortBy as AlertSortableColumn) ?? "triggeredAt";
  const column = SORTABLE_COLUMNS[sortBy] ?? alerts.triggeredAt;
  const orderBy = params.sortOrder === "asc" ? asc(column) : desc(column);
  const offset = (params.page - 1) * params.limit;

  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(alerts)
      .where(where)
      .orderBy(orderBy)
      .limit(params.limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(alerts).where(where),
  ]);

  return { items, total: totalRow[0]?.count ?? 0 };
};

export const findAlertById = async (id: string): Promise<Alert | undefined> =>
  await db.query.alerts.findFirst({ where: eq(alerts.id, id) });

export const findAlertByAlertId = async (
  alertId: string,
): Promise<Alert | undefined> =>
  await db.query.alerts.findFirst({ where: eq(alerts.alertId, alertId) });

export const createAlert = async (
  values: Omit<Alert, "id" | "createdAt" | "updatedAt">,
): Promise<Alert> => {
  const [row] = await db.insert(alerts).values(values).returning();
  return row;
};

export const upsertAlertByAlertId = async (
  values: Omit<Alert, "id" | "createdAt" | "updatedAt">,
): Promise<Alert> => {
  const existing = await findAlertByAlertId(values.alertId);

  if (existing) {
    const [row] = await db
      .update(alerts)
      .set({
        ...values,
        updatedAt: new Date(),
        triggeredAt: existing.triggeredAt,
        createdAt: existing.createdAt,
      })
      .where(eq(alerts.alertId, values.alertId))
      .returning();
    return row;
  }

  const [row] = await db.insert(alerts).values(values).returning();
  return row;
};

export const acknowledgeAlert = async (
  id: string,
  acknowledgedBy?: string,
): Promise<Alert | undefined> => {
  const [row] = await db
    .update(alerts)
    .set({
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
      acknowledgedBy: acknowledgedBy ?? null,
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, id))
    .returning();
  return row;
};

export const clearAlert = async (
  id: string,
  clearedBy?: string,
): Promise<Alert | undefined> => {
  const [row] = await db
    .update(alerts)
    .set({
      status: "CLEARED",
      clearedAt: new Date(),
      clearedBy: clearedBy ?? null,
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, id))
    .returning();
  return row;
};

export const clearAlertByAlertId = async (
  alertId: string,
  clearedBy?: string,
): Promise<Alert | undefined> => {
  const [row] = await db
    .update(alerts)
    .set({
      status: "CLEARED",
      clearedAt: new Date(),
      clearedBy: clearedBy ?? null,
      updatedAt: new Date(),
    })
    .where(eq(alerts.alertId, alertId))
    .returning();
  return row;
};
