import {
  type Alert,
  type AlertAction,
  type AlertTrackHistory,
  alertActions,
  alerts,
  alertTrackHistory,
  db,
  type NewAlert,
} from "@repo/database";
import type { IncidentAlertInput } from "@repo/shared/alert-incident";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
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
  verificationStatus: alerts.verificationStatus,
} as const;

export type AlertSortableColumn = keyof typeof SORTABLE_COLUMNS;

/** Alert ID dipisah koma menjadi satu filter; kosong berarti tanpa filter. */
const alertIdsFilter = (raw: string | undefined): SQL | undefined => {
  const ids = (raw ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 0 ? inArray(alerts.alertId, ids) : undefined;
};

const buildFilters = (params: ListAlertsInput): SQL | undefined => {
  // Pencarian bebas: Alert ID / tipe / track / callsign (callsign tinggal di
  // data jsonb, bukan kolom tersendiri). Query dipecah per spasi agar "Area
  // Penetration" bisa cocok dengan tipe "AREA_PENETRATION": tiap token harus
  // ditemukan (AND antar token), bebas di kolom mana (OR antar kolom).
  const searchTokens = (params.q ?? "")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const filters: (SQL | undefined)[] = [
    params.airportId ? eq(alerts.airportId, params.airportId) : undefined,
    params.type ? eq(alerts.type, params.type) : undefined,
    params.severity
      ? ((): SQL | undefined => {
          const list = params.severity
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          return list.length > 0 ? inArray(alerts.severity, list) : undefined;
        })()
      : undefined,
    params.status ? eq(alerts.status, params.status) : undefined,
    params.verificationStatus
      ? eq(alerts.verificationStatus, params.verificationStatus)
      : undefined,
    params.clearedBy ? eq(alerts.clearedBy, params.clearedBy) : undefined,
    params.verifiedBy ? eq(alerts.verifiedBy, params.verifiedBy) : undefined,
    params.includeDeleted ? undefined : isNull(alerts.deletedAt),
    params.trackId ? eq(alerts.trackId, params.trackId) : undefined,
    params.relatedTrackId
      ? eq(alerts.relatedTrackId, params.relatedTrackId)
      : undefined,
    params.startDate ? gte(alerts.triggeredAt, params.startDate) : undefined,
    params.endDate ? lte(alerts.triggeredAt, params.endDate) : undefined,
    alertIdsFilter(params.alertIds),
    ...searchTokens.map(
      (token) =>
        or(
          ilike(alerts.alertId, `%${token}%`),
          ilike(alerts.type, `%${token}%`),
          ilike(alerts.trackId, `%${token}%`),
          ilike(sql`(${alerts.data} ->> 'callsign')`, `%${token}%`),
          ilike(sql`(${alerts.data} -> 'track' ->> 'callsign')`, `%${token}%`),
        ) as SQL,
    ),
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

export interface ExportAlertFilterParams {
  airportId?: string;
  type?: string;
  alertType?: string;
  severity?: string;
  status?: string;
  trackId?: string;
  startDateTime: Date;
  endDateTime: Date;
}

export const getAlertsForExport = async (
  params: ExportAlertFilterParams,
): Promise<Alert[]> => {
  const typeFilter = params.alertType ?? params.type;
  const filters: (SQL | undefined)[] = [
    params.airportId ? eq(alerts.airportId, params.airportId) : undefined,
    typeFilter ? eq(alerts.type, typeFilter) : undefined,
    params.severity ? eq(alerts.severity, params.severity) : undefined,
    params.status ? eq(alerts.status, params.status) : undefined,
    params.trackId ? eq(alerts.trackId, params.trackId) : undefined,
    gte(alerts.triggeredAt, params.startDateTime),
    lte(alerts.triggeredAt, params.endDateTime),
  ];

  const active = filters.filter(
    (filter): filter is SQL => filter !== undefined,
  );
  const where = active.length === 1 ? active[0] : and(...active);

  return db
    .select()
    .from(alerts)
    .where(where)
    .orderBy(desc(alerts.triggeredAt));
};

export const findAlertById = async (id: string): Promise<Alert | undefined> =>
  await db.query.alerts.findFirst({ where: eq(alerts.id, id) });

export const findAlertByAlertId = async (
  alertId: string,
): Promise<Alert | undefined> =>
  await db.query.alerts.findFirst({ where: eq(alerts.alertId, alertId) });

export type InsertAlertValues = Omit<
  NewAlert,
  "id" | "createdAt" | "updatedAt"
>;

export const createAlert = async (
  values: InsertAlertValues,
): Promise<Alert> => {
  const [row] = await db.insert(alerts).values(values).returning();
  return row;
};

export const upsertAlertByAlertId = async (
  values: InsertAlertValues,
): Promise<Alert> => {
  const existing = await findAlertByAlertId(values.alertId);

  if (existing) {
    // Upsert hanya dicapai lewat claim Redis baru (alert baru atau resurrect
    // setelah CLEARED) — jadi row lama BUKAN lanjutan episode lama. Pertahankan
    // triggeredAt/createdAt lama di sini salah: FE (isAlertRecent, window 5m)
    // dan expiry sweep memakai triggeredAt — alert resurrect dengan timestamp
    // lama langsung dianggap kedaluwarsa, tidak pernah muncul di tab Live.
    const [row] = await db
      .update(alerts)
      .set({
        ...values,
        updatedAt: new Date(),
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

export interface ClearAlertRepoParams {
  clearedBy?: string;
  reason?: string;
}

export const clearAlert = async (
  id: string,
  params?: ClearAlertRepoParams,
): Promise<Alert | undefined> => {
  const [row] = await db
    .update(alerts)
    .set({
      status: "CLEARED",
      clearedAt: new Date(),
      clearedBy: params?.clearedBy ?? null,
      clearReason: params?.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, id))
    .returning();
  return row;
};

export const clearAlertByAlertId = async (
  alertId: string,
  params?: ClearAlertRepoParams,
): Promise<Alert | undefined> => {
  const [row] = await db
    .update(alerts)
    .set({
      status: "CLEARED",
      clearedAt: new Date(),
      clearedBy: params?.clearedBy ?? null,
      clearReason: params?.reason ?? null,
      updatedAt: new Date(),
    })
    .where(eq(alerts.alertId, alertId))
    .returning();
  return row;
};

export interface VerifyAlertRepoParams {
  status: "VERIFIED" | "FALSE_ALARM" | "UNVERIFIED";
  note?: string;
  verifiedBy?: string;
}

export const verifyAlert = async (
  id: string,
  params: VerifyAlertRepoParams,
): Promise<Alert | undefined> => {
  const [row] = await db
    .update(alerts)
    .set({
      verificationStatus: params.status,
      verifiedAt: new Date(),
      verifiedBy: params.verifiedBy ?? null,
      verificationNote: params.note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, id))
    .returning();
  return row;
};

export const softDeleteAlert = async (
  id: string,
): Promise<Alert | undefined> => {
  const [row] = await db
    .update(alerts)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(alerts.id, id))
    .returning();
  return row;
};

export interface RecordAlertActionParams {
  alertId: string;
  action: "ACKNOWLEDGE" | "CLEAR" | "VERIFY" | "DELETE";
  actorId?: string | null;
  actorName?: string | null;
  previousStatus?: string | null;
  newStatus?: string | null;
  previousVerificationStatus?: string | null;
  newVerificationStatus?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
}

export const recordAlertAction = async (
  params: RecordAlertActionParams,
): Promise<AlertAction> => {
  const [row] = await db
    .insert(alertActions)
    .values({
      alertId: params.alertId,
      action: params.action,
      actorId: params.actorId ?? null,
      actorName: params.actorName ?? null,
      previousStatus: params.previousStatus ?? null,
      newStatus: params.newStatus ?? null,
      previousVerificationStatus: params.previousVerificationStatus ?? null,
      newVerificationStatus: params.newVerificationStatus ?? null,
      note: params.note ?? null,
      metadata: params.metadata ?? {},
    })
    .returning();
  return row;
};

export const getAlertActions = async (
  alertId: string,
): Promise<AlertAction[]> => {
  return db
    .select()
    .from(alertActions)
    .where(eq(alertActions.alertId, alertId))
    .orderBy(desc(alertActions.createdAt));
};

export const mergeAlertData = async (
  alertId: string,
  extra: Record<string, unknown>,
): Promise<Alert | undefined> => {
  const existing = await db
    .select({ data: alerts.data })
    .from(alerts)
    .where(eq(alerts.alertId, alertId))
    .limit(1);

  if (existing.length === 0) return undefined;

  const merged = {
    ...((existing[0].data as Record<string, unknown> | null) ?? {}),
    ...extra,
  };

  const [row] = await db
    .update(alerts)
    .set({ data: merged, updatedAt: new Date() })
    .where(eq(alerts.alertId, alertId))
    .returning();
  return row;
};

export interface AlertTrackHistoryPoint {
  alertId: string;
  trackId: string;
  kind: "main" | "related";
  targetType?: string | null;
  callsign?: string | null;
  registration?: string | null;
  latitude: number;
  longitude: number;
  altitude?: number | null;
  groundSpeed?: number | null;
  heading?: number | null;
  onGround?: boolean | null;
  timestamp: Date;
}

export const insertAlertTrackHistory = async (
  records: AlertTrackHistoryPoint[],
): Promise<void> => {
  if (records.length === 0) return;
  await db.insert(alertTrackHistory).values(records);
};

export interface AlertTrackHistoryResult {
  main: AlertTrackHistory[];
  related: AlertTrackHistory[];
}

export const getAlertTrackHistory = async (
  alertId: string,
): Promise<AlertTrackHistoryResult> => {
  const rows = await db
    .select()
    .from(alertTrackHistory)
    .where(eq(alertTrackHistory.alertId, alertId))
    .orderBy(
      asc(alertTrackHistory.timestamp),
      asc(alertTrackHistory.createdAt),
    );

  const main: AlertTrackHistory[] = [];
  const related: AlertTrackHistory[] = [];
  for (const row of rows) {
    if (row.kind === "related") related.push(row);
    else main.push(row);
  }
  return { main, related };
};

export interface IncidentSourceParams {
  airportId?: string;
  startDate: Date;
  endDate: Date;
}

/** Kolom ringkas semua alert pada rentang itu, terlama dahulu, untuk dikelompokkan menjadi kejadian. */
export const listIncidentSources = async (
  params: IncidentSourceParams,
): Promise<IncidentAlertInput[]> => {
  const rows = await db
    .select({
      alertId: alerts.alertId,
      type: alerts.type,
      severity: alerts.severity,
      status: alerts.status,
      triggeredAt: alerts.triggeredAt,
      trackId: alerts.trackId,
      verificationStatus: alerts.verificationStatus,
      callsign: sql<
        string | null
      >`coalesce(${alerts.data} ->> 'callsign', ${alerts.data} -> 'track' ->> 'callsign')`,
      relatedCallsign: sql<string | null>`${alerts.data} ->> 'relatedCallsign'`,
    })
    .from(alerts)
    .where(
      and(
        isNull(alerts.deletedAt),
        gte(alerts.triggeredAt, params.startDate),
        lte(alerts.triggeredAt, params.endDate),
        params.airportId ? eq(alerts.airportId, params.airportId) : undefined,
      ),
    )
    .orderBy(asc(alerts.triggeredAt));

  return rows.map((r) => ({ ...r, triggeredAt: r.triggeredAt.getTime() }));
};

export const findAlertsByAlertIds = async (
  alertIds: string[],
): Promise<Alert[]> =>
  alertIds.length === 0
    ? []
    : await db
        .select()
        .from(alerts)
        .where(
          and(inArray(alerts.alertId, alertIds), isNull(alerts.deletedAt)),
        );

/** Alert terakhir untuk entitas ini yang selesai sejak `since`; null bila tidak ada. Entitas dikenali dari `data.entityKey` yang disimpan saat alert dibuat. */
export const findRecentlyClearedAlert = async (
  airportId: string,
  type: string,
  entityKey: string,
  since: Date,
): Promise<Alert | undefined> => {
  const [row] = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.airportId, airportId),
        eq(alerts.type, type),
        eq(alerts.status, "CLEARED"),
        isNull(alerts.deletedAt),
        gte(alerts.clearedAt, since),
        sql`${alerts.data} ->> 'entityKey' = ${entityKey}`,
      ),
    )
    .orderBy(desc(alerts.clearedAt))
    .limit(1);
  return row;
};

/** Buka kembali alert yang selesai: aktif lagi, jejak penyelesaiannya dihapus, dan hitungan pembukaan ulang naik. */
export const reopenAlert = async (id: string): Promise<Alert | undefined> => {
  const [row] = await db
    .update(alerts)
    .set({
      status: "ACTIVE",
      clearedAt: null,
      clearedBy: null,
      clearReason: null,
      updatedAt: new Date(),
      data: sql`jsonb_set(${alerts.data}, '{reopenCount}', (coalesce((${alerts.data} ->> 'reopenCount')::int, 0) + 1)::text::jsonb)`,
    })
    .where(eq(alerts.id, id))
    .returning();
  return row;
};
