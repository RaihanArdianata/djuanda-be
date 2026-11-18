import { aeroswarmMovements, alertActions, alerts, db } from "@repo/database";
import { and, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  type AlertDetail,
  type AlertDetailRow,
  type AlertDetailsByCategory,
  type AlertIncidentSummary,
  analyzeAlertRows,
  KNOWN_ALERT_TYPES,
  NO_INCIDENTS,
} from "../lib/alert-detail";
import {
  computePeriodBuckets,
  exclusiveEndBoundaryJakarta,
  type PeriodType,
  startOfDayJakarta,
} from "../lib/period";
import type { GetOperationalStatisticsParams } from "../validator/statistics.validator";
export interface AircraftMovementBreakdown {
  aircraft: string;
  count: number;
  at: string | null;
}

export interface AircraftListItem {
  aircraft: string;
  count: number;
}

export interface OperationalTrendPoint {
  period: string;
  periodRange?: string;
  aircraft: number;
  aircraftList: AircraftListItem[];
  groundVehicle: number;
  takeoff: number;
  landing: number;
  totalMovement: number;
  alerts: number;
  takeoffAircraftCount: number;
  landingAircraftCount: number;
  takeoffAircraft: AircraftMovementBreakdown[];
  landingAircraft: AircraftMovementBreakdown[];
}

export interface OperationalStatisticsResult {
  period: GetOperationalStatisticsParams["period"];
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  traffic: {
    totalAircraft: number;
    totalGroundVehicle: number;
    totalTraffic: number;
    averageTrafficPerHour: number;
    peakTrafficMovement: number;
    peakTrafficHour: string | null;
  };
  movement: {
    totalTakeoff: number;
    totalLanding: number;
    averageMovementPerHour: number;
    peakHourMovement: number;
    peakHour: string | null;
  };
  alerts: AlertSummary;
  trend: OperationalTrendPoint[];
}

type MovementType = "takeoff" | "landing";
type MovementAggGroup =
  | "total"
  | "hour"
  | "bucket"
  | "bucket_label"
  | "bucket_type_label";

interface MovementAggQueryRow {
  grp: MovementAggGroup;
  /** Kunci jam `YYYY-MM-DDTHH:00` (grp `hour`). */
  hour_bucket: string | null;
  /** Kunci bucket periode = `PeriodBucket.period` (grp `bucket*`). */
  bucket: string | null;
  aircraft_label: string | null;
  movement_type: MovementType | null;
  /** Jumlah track unik (`total`, `hour`, `bucket`) atau track per label (`bucket_label`). */
  aircraft: number | null;
  takeoff: number | null;
  landing: number | null;
  event_count: number | null;
  last_at: string | null;
  [column: string]: string | number | null;
}

interface MovementTotals {
  aircraft: number;
  takeoff: number;
  landing: number;
}

interface AircraftStat {
  count: number;
  at: string | null;
}

/** Ringkasan satu jam: `aircraft` = track unik pada jam itu. */
interface HourAgg {
  aircraft: number;
  takeoff: number;
  landing: number;
}

/** Ringkasan satu bucket periode (hari/minggu/bulan/jam). */
interface BucketAgg {
  /** Track unik di seluruh bucket (dihitung DB, bukan penjumlahan antar jam). */
  aircraft: number;
  takeoff: number;
  landing: number;
  /** Label pesawat -> jumlah track unik berlabel itu. */
  aircraftLabels: Map<string, number>;
  takeoffAircraft: Map<string, AircraftStat>;
  landingAircraft: Map<string, AircraftStat>;
}

interface PeakHour {
  hour: string;
  movement: number;
}

interface ParsedMovementAgg {
  totals: MovementTotals;
  hourMap: Map<string, HourAgg>;
  bucketMap: Map<string, BucketAgg>;
  peakHour: PeakHour | null;
}

function getOrCreateBucket(
  bucketMap: Map<string, BucketAgg>,
  key: string,
): BucketAgg {
  let entry = bucketMap.get(key);
  if (!entry) {
    entry = {
      aircraft: 0,
      takeoff: 0,
      landing: 0,
      aircraftLabels: new Map<string, number>(),
      takeoffAircraft: new Map<string, AircraftStat>(),
      landingAircraft: new Map<string, AircraftStat>(),
    };
    bucketMap.set(key, entry);
  }
  return entry;
}

function computePeakHour(hourMap: Map<string, HourAgg>): PeakHour | null {
  let peak: PeakHour | null = null;
  for (const [hour, entry] of hourMap) {
    const movement = entry.takeoff + entry.landing;
    if (!peak || movement > peak.movement) {
      peak = { hour, movement };
    }
  }
  return peak;
}

function computePeakTrafficHour(
  hourMap: Map<string, HourAgg>,
): PeakHour | null {
  let peak: PeakHour | null = null;
  for (const [hour, entry] of hourMap) {
    if (!peak || entry.aircraft > peak.movement) {
      peak = { hour, movement: entry.aircraft };
    }
  }
  return peak;
}

interface TrafficMetrics {
  averageTrafficPerHour: number;
  peakTrafficMovement: number;
  peakTrafficHour: string | null;
}

function computeTrafficMetrics(
  hourMap: Map<string, HourAgg>,
  rangeHours: number,
): TrafficMetrics {
  let sumHourlyAircraft = 0;
  for (const entry of hourMap.values()) {
    sumHourlyAircraft += entry.aircraft;
  }

  const peak = computePeakTrafficHour(hourMap);

  return {
    averageTrafficPerHour:
      Math.round((sumHourlyAircraft / rangeHours) * 100) / 100,
    peakTrafficMovement: peak?.movement ?? 0,
    peakTrafficHour: peak?.hour ?? null,
  };
}

function rowCounts(row: MovementAggQueryRow): MovementTotals {
  return {
    aircraft: row.aircraft ?? 0,
    takeoff: row.takeoff ?? 0,
    landing: row.landing ?? 0,
  };
}

function applyBucketRow(
  bucketMap: Map<string, BucketAgg>,
  row: MovementAggQueryRow,
): void {
  if (!row.bucket) return;
  Object.assign(getOrCreateBucket(bucketMap, row.bucket), rowCounts(row));
}

function applyBucketLabelRow(
  bucketMap: Map<string, BucketAgg>,
  row: MovementAggQueryRow,
): void {
  if (!row.bucket || !row.aircraft_label) return;
  getOrCreateBucket(bucketMap, row.bucket).aircraftLabels.set(
    row.aircraft_label,
    row.aircraft ?? 0,
  );
}

function applyBucketTypeLabelRow(
  bucketMap: Map<string, BucketAgg>,
  row: MovementAggQueryRow,
): void {
  if (!row.bucket || !row.aircraft_label || !row.movement_type) return;
  const entry = getOrCreateBucket(bucketMap, row.bucket);
  const target =
    row.movement_type === "takeoff"
      ? entry.takeoffAircraft
      : entry.landingAircraft;
  target.set(row.aircraft_label, {
    count: row.event_count ?? 0,
    at: row.last_at ?? null,
  });
}

/**
 * Baris `hour` datang terurut naik menurut jam (ORDER BY di query), sehingga
 * pada nilai puncak yang sama jam paling awal yang dipilih.
 */
export function parseMovementAggRows(
  rows: MovementAggQueryRow[],
): ParsedMovementAgg {
  const totals: MovementTotals = { aircraft: 0, takeoff: 0, landing: 0 };
  const hourMap = new Map<string, HourAgg>();
  const bucketMap = new Map<string, BucketAgg>();

  for (const row of rows) {
    switch (row.grp) {
      case "total":
        Object.assign(totals, rowCounts(row));
        break;
      case "hour":
        if (row.hour_bucket) hourMap.set(row.hour_bucket, rowCounts(row));
        break;
      case "bucket":
        applyBucketRow(bucketMap, row);
        break;
      case "bucket_label":
        applyBucketLabelRow(bucketMap, row);
        break;
      case "bucket_type_label":
        applyBucketTypeLabelRow(bucketMap, row);
        break;
    }
  }

  return { totals, hourMap, bucketMap, peakHour: computePeakHour(hourMap) };
}

interface AlertTrendRow {
  bucket: string;
  total: number;
  runwayIncursion: number;
  areaPenetration: number;
  deviation: number;
  taxiwayApronIncursion: number;
  stca: number;
}
export interface AlertTotals {
  stca: number;
  apa: number;
  da: number;
  ria: number;
  taia: number;
  total: number;
}

export interface AlertCategorySummary {
  count: number;
  details: AlertDetail[];
}

export interface AlertSummary {
  stca: AlertCategorySummary;
  apa: AlertCategorySummary;
  da: AlertCategorySummary;
  ria: AlertCategorySummary;
  taia: AlertCategorySummary;
  total: number;
  /** Alert yang sama digabung menjadi kejadian. */
  incidents: AlertIncidentSummary;
}

export function buildAlertSummary(
  totals: AlertTotals,
  details: AlertDetailsByCategory,
  incidents: AlertIncidentSummary = NO_INCIDENTS,
): AlertSummary {
  return {
    stca: { count: totals.stca, details: details.stca },
    apa: { count: totals.apa, details: details.apa },
    da: { count: totals.da, details: details.da },
    ria: { count: totals.ria, details: details.ria },
    taia: { count: totals.taia, details: details.taia },
    total: totals.total,
    incidents,
  };
}

export function severityWhere(severity: string | undefined): SQL | undefined {
  if (!severity) return undefined;
  return sql`upper(${alerts.severity}) = ${severity.trim().toUpperCase()}`;
}

export function sumAlertTotals(alertTrendRows: AlertTrendRow[]): AlertTotals {
  return alertTrendRows.reduce<AlertTotals>(
    (acc, row) => ({
      stca: acc.stca + row.stca,
      apa: acc.apa + row.areaPenetration,
      da: acc.da + row.deviation,
      ria: acc.ria + row.runwayIncursion,
      taia: acc.taia + row.taxiwayApronIncursion,
      total: acc.total + row.total,
    }),
    { stca: 0, apa: 0, da: 0, ria: 0, taia: 0, total: 0 },
  );
}
export function timeOfDayWhere(
  timeColumn: PgColumn,
  startTime: string | undefined,
  endTime: string | undefined,
): SQL | undefined {
  if (!startTime || !endTime) return undefined;
  return sql`(${timeColumn} AT TIME ZONE 'Asia/Jakarta')::time >= ${startTime}::time
    AND (${timeColumn} AT TIME ZONE 'Asia/Jakarta')::time < ${endTime}::time`;
}

function timeRangeWhere(
  timeColumn: PgColumn,
  airportColumn: PgColumn,
  rangeStart: Date,
  rangeEndExclusive: Date,
  airportId: string | undefined,
  timeOfDay: SQL | undefined,
): SQL | undefined {
  const conditions: SQL[] = [
    gte(timeColumn, rangeStart),
    lt(timeColumn, rangeEndExclusive),
  ];
  if (airportId) {
    conditions.push(eq(airportColumn, airportId));
  }
  if (timeOfDay) {
    conditions.push(timeOfDay);
  }
  return and(...conditions);
}

function toAircraftBreakdown(
  counts: Map<string, AircraftStat>,
): AircraftMovementBreakdown[] {
  return Array.from(counts, ([aircraft, stat]) => ({
    aircraft,
    count: stat.count,
    at: stat.at,
  })).sort((a, b) => {
    // urutkan berdasarkan `at` desc (terbaru -> terlama); null ditaruh paling akhir
    if (a.at && b.at) {
      if (a.at !== b.at) return b.at.localeCompare(a.at);
    } else if (a.at || b.at) {
      return a.at ? -1 : 1;
    }
    return b.count - a.count || a.aircraft.localeCompare(b.aircraft);
  });
}

/** Urutkan label pesawat; `count` = jumlah track unik (jumlah semua count = `aircraft`). */
function toAircraftList(labelCounts: Map<string, number>): AircraftListItem[] {
  return Array.from(labelCounts, ([aircraft, count]) => ({
    aircraft,
    count,
  })).sort((a, b) => a.aircraft.localeCompare(b.aircraft));
}

export function buildTrend(
  params: GetOperationalStatisticsParams,
  bucketMap: Map<string, BucketAgg>,
  bucketAlertMap: Map<string, number>,
): OperationalTrendPoint[] {
  const buckets = computePeriodBuckets(
    params.period,
    params.startDate,
    params.endDate,
    params.startTime,
    params.endTime,
  );

  return buckets.map(({ period, periodStart, periodEnd }) => {
    const agg = bucketMap.get(period);
    const takeoff = agg?.takeoff ?? 0;
    const landing = agg?.landing ?? 0;
    const takeoffAircraftCounts =
      agg?.takeoffAircraft ?? new Map<string, AircraftStat>();
    const landingAircraftCounts =
      agg?.landingAircraft ?? new Map<string, AircraftStat>();

    const point: OperationalTrendPoint = {
      period,
      aircraft: agg?.aircraft ?? 0,
      aircraftList: toAircraftList(
        agg?.aircraftLabels ?? new Map<string, number>(),
      ),
      groundVehicle: 0,
      takeoff,
      landing,
      totalMovement: takeoff + landing,
      alerts: bucketAlertMap.get(period) ?? 0,
      takeoffAircraftCount: takeoffAircraftCounts.size,
      landingAircraftCount: landingAircraftCounts.size,
      takeoffAircraft: toAircraftBreakdown(takeoffAircraftCounts),
      landingAircraft: toAircraftBreakdown(landingAircraftCounts),
    };
    if (params.period !== "daily") {
      point.periodRange = `${periodStart} - ${periodEnd}`;
    }
    return point;
  });
}

const DEFAULT_AIRPORT_ID = "WARR";

/**
 * Kunci bucket periode dihitung di PostgreSQL dari timestamp lokal Jakarta
 * (`timestamp without time zone`) dan harus identik dengan
 * `computePeriodBuckets(...).period`:
 * - hourly  -> `YYYY-MM-DDTHH:00`
 * - daily   -> tanggal
 * - weekly  -> Senin minggu itu (ISO), dipotong ke `startDate` pada minggu pertama
 * - monthly -> tanggal 1 bulan itu, dipotong ke `startDate` pada bulan pertama
 */
export function bucketKeyExpr(
  period: PeriodType,
  localTimestamp: SQL,
  startDate: string,
): SQL<string> {
  switch (period) {
    case "hourly":
      return sql<string>`to_char(date_trunc('hour', ${localTimestamp}), 'YYYY-MM-DD"T"HH24:00')`;
    case "daily":
      return sql<string>`to_char((${localTimestamp})::date, 'YYYY-MM-DD')`;
    case "weekly":
      return sql<string>`to_char(GREATEST(date_trunc('week', ${localTimestamp})::date, ${startDate}::date), 'YYYY-MM-DD')`;
    case "monthly":
      return sql<string>`to_char(GREATEST(date_trunc('month', ${localTimestamp})::date, ${startDate}::date), 'YYYY-MM-DD')`;
  }
}

export async function getOperationalStatistics(
  params: GetOperationalStatisticsParams,
): Promise<OperationalStatisticsResult> {
  const rangeStart = startOfDayJakarta(params.startDate);
  const rangeEndExclusive = exclusiveEndBoundaryJakarta(params.endDate);
  const rangeStartIso = rangeStart.toISOString();
  // Semua query selalu dibatasi satu bandara (sama dengan default laporan Excel).
  const airportId =
    params.airportId ?? process.env.AEROSWARM_AIRPORT_ID ?? DEFAULT_AIRPORT_ID;

  const alertWhereClause = and(
    timeRangeWhere(
      alerts.triggeredAt,
      alerts.airportId,
      rangeStart,
      rangeEndExclusive,
      airportId,
      timeOfDayWhere(alerts.triggeredAt, params.startTime, params.endTime),
    ),
    severityWhere(params.severity),
  );

  const movementWhereClause = timeRangeWhere(
    aeroswarmMovements.at,
    aeroswarmMovements.airportId,
    rangeStart,
    rangeEndExclusive,
    airportId,
    timeOfDayWhere(aeroswarmMovements.at, params.startTime, params.endTime),
  );

  // Alert: bucket periode dihitung di DB, jadi hasilnya <= jumlah bucket (bukan per jam).
  const alertBucketExpr = bucketKeyExpr(
    params.period,
    sql`(${alerts.triggeredAt} AT TIME ZONE 'Asia/Jakarta')`,
    params.startDate,
  );
  // Movement: `hour_local` adalah timestamp lokal Jakarta yang dibulatkan ke jam.
  const movementBucketExpr = bucketKeyExpr(
    params.period,
    sql`hour_local`,
    params.startDate,
  );
  const typeFilter = (alertType: string): SQL<number> =>
    sql<number>`count(*) filter (where upper(${alerts.type}) = ${alertType})::int`;

  // Tanpa db.transaction: pada node-postgres satu transaksi = satu koneksi, sehingga
  // Promise.all di dalamnya tetap berjalan berurutan. Query ini hanya membaca, jadi
  // dijalankan langsung di pool agar benar-benar paralel di koneksi terpisah.
  const [alertTrendRows, alertDetailResult, movementAggResult] =
    await Promise.all([
      db
        .select({
          bucket: alertBucketExpr,
          total: sql<number>`count(*)::int`,
          runwayIncursion: typeFilter("RUNWAY_INCURSION"),
          areaPenetration: typeFilter("AREA_PENETRATION"),
          deviation: typeFilter("DEVIATION"),
          taxiwayApronIncursion: typeFilter("TAXIWAY_APRON_INCURSION"),
          stca: typeFilter("STCA"),
        })
        .from(alerts)
        .where(alertWhereClause)
        .groupBy(sql`1`),
      // Detail alert. Perubahan penting dibanding versi sebelumnya:
      // 1. JSONB `alerts.data` dibaca SEKALI per baris lewat `jsonb_to_record` (LATERAL).
      //    Sebelumnya ~57 operator `data -> 'x'` / `#>` masing-masing membuka ulang
      //    (detoast + dekompresi) seluruh JSONB yang sama untuk setiap alert.
      // 2. Riwayat VERIFY diagregasi sekali dari `alert_actions` (index
      //    `alert_actions_created_at_idx`) lalu di-join per alert_id. Subquery `IN (SELECT ...
      //    FROM alerts ...)` yang membaca ulang `alerts` dihapus. Aksi pada alert selalu
      //    dibuat setelah alert dipicu, jadi `created_at >= awal rentang` tidak membuang
      //    aksi milik alert di dalam rentang.
      db.execute<AlertDetailRow>(sql`
        SELECT
          ${alerts.alertId} AS alert_id,
          ${alerts.trackId} AS track_id,
          ${alerts.airportId} AS airport_id,
          ${alerts.type} AS type,
          ${alerts.severity} AS severity,
          ${alerts.relatedTrackId} AS related_track_id,
          to_char(${alerts.triggeredAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS time,
          ${alerts.verificationStatus} AS verification_status,
          ${alerts.verifiedBy} AS verified_by,
          to_char(${alerts.verifiedAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00' AS verified_at,
          ${alerts.verificationNote} AS verification_note,
          history.verification_history AS verification_history,
          jsonb_build_object(
            'callsign', d."callsign",
            'relatedCallsign', d."relatedCallsign",
            'domain', d."domain",
            'reason', d."reason",
            'runwayName', d."runwayName",
            'runwayStatus', d."runwayStatus",
            'predictedTimeSeconds', d."predictedTimeSeconds",
            'horizontalSeparationNm', d."horizontalSeparationNm",
            'minimumHorizontalSeparationNm', d."minimumHorizontalSeparationNm",
            'horizontalSeparationMeters', d."horizontalSeparationMeters",
            'minimumSeparationMeters', d."minimumSeparationMeters",
            'predictedVerticalSeparationFt', d."predictedVerticalSeparationFt",
            'minimumVerticalSeparationFt', d."minimumVerticalSeparationFt",
            'distanceMeters', d."distanceMeters",
            'maxDistanceMeters', d."maxDistanceMeters",
            'criticalMeters', d."criticalMeters",
            'horizontalDistanceMeters', d."horizontalDistanceMeters",
            'altitudeDeviationFt', d."altitudeDeviationFt",
            'maxAltitudeDeviationFt', d."maxAltitudeDeviationFt",
            'timeDeviationSeconds', d."timeDeviationSeconds",
            'timeExceeded', d."timeExceeded",
            'areaName', d."areaName",
            'areaType', d."areaType",
            'areaStatus', d."areaStatus",
            'surfaceName', d."surfaceName",
            'surfaceType', d."surfaceType",
            'surfaceId', d."surfaceId",
            'track', jsonb_build_object(
              'callsign', d."track" -> 'callsign'
            ),
            'area', jsonb_build_object(
              'id', d."area" -> 'id',
              'name', d."area" -> 'name',
              'type', d."area" -> 'type',
              'status', d."area" -> 'status'
            ),
            'surface', jsonb_build_object(
              'id', d."surface" -> 'id',
              'name', d."surface" -> 'name',
              'type', d."surface" -> 'type',
              'status', d."surface" -> 'status'
            )
          ) AS detail_data
        FROM ${alerts}
        CROSS JOIN LATERAL jsonb_to_record(
          CASE
            WHEN jsonb_typeof(${alerts.data}) = 'object' THEN ${alerts.data}
            ELSE '{}'::jsonb
          END
        ) AS d(
          "callsign" jsonb,
          "relatedCallsign" jsonb,
          "domain" jsonb,
          "reason" jsonb,
          "runwayName" jsonb,
          "runwayStatus" jsonb,
          "predictedTimeSeconds" jsonb,
          "horizontalSeparationNm" jsonb,
          "minimumHorizontalSeparationNm" jsonb,
          "horizontalSeparationMeters" jsonb,
          "minimumSeparationMeters" jsonb,
          "predictedVerticalSeparationFt" jsonb,
          "minimumVerticalSeparationFt" jsonb,
          "distanceMeters" jsonb,
          "maxDistanceMeters" jsonb,
          "criticalMeters" jsonb,
          "horizontalDistanceMeters" jsonb,
          "altitudeDeviationFt" jsonb,
          "maxAltitudeDeviationFt" jsonb,
          "timeDeviationSeconds" jsonb,
          "timeExceeded" jsonb,
          "areaName" jsonb,
          "areaType" jsonb,
          "areaStatus" jsonb,
          "surfaceName" jsonb,
          "surfaceType" jsonb,
          "surfaceId" jsonb,
          "track" jsonb,
          "area" jsonb,
          "surface" jsonb
        )
        LEFT JOIN (
          SELECT
            ${alertActions.alertId} AS alert_id,
            jsonb_agg(
              jsonb_build_object(
                'at', to_char(${alertActions.createdAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS') || '+07:00',
                'by', ${alertActions.actorName},
                'from', ${alertActions.previousVerificationStatus},
                'to', ${alertActions.newVerificationStatus},
                'note', ${alertActions.note}
              )
              ORDER BY ${alertActions.createdAt}
            ) AS verification_history
          FROM ${alertActions}
          WHERE ${alertActions.action} = 'VERIFY'
            AND ${alertActions.createdAt} >= ${rangeStartIso}::timestamptz
          GROUP BY ${alertActions.alertId}
        ) AS history ON history.alert_id = ${alerts.alertId}
        WHERE ${alertWhereClause}
          AND upper(${alerts.type}) IN (${sql.join(
            KNOWN_ALERT_TYPES.map((type) => sql`${type}`),
            sql`, `,
          )})
        ORDER BY ${alerts.triggeredAt} DESC, ${alerts.id} DESC
      `),
      // Satu kali baca `aeroswarm_movements` (hanya kolom yang dibutuhkan, tanpa JSONB
      // `data`), direduksi ke `ev` per (track, jam, type, label). Seluruh ringkasan
      // diturunkan dari `ev`, jadi tabel tidak dibaca ulang dan tidak ada baris
      // per-track/per-event yang dikirim ke JavaScript.
      // Tanpa kata kunci MATERIALIZED: itu sintaks PostgreSQL 12 ke atas, sedangkan server database kantor PostgreSQL 11. CTE `ev`
      // dibaca dua kali, jadi PostgreSQL 12 ke atas pun otomatis menyimpannya (PostgreSQL 11 selalu); hasilnya sama.
      db.execute<MovementAggQueryRow>(sql`
        WITH ev AS (
          SELECT
            m.track_id,
            m.hour_local,
            m.type,
            m.aircraft_label,
            count(*)::int AS cnt,
            max(m.at) AS last_at
          FROM (
            SELECT
              ${aeroswarmMovements.trackId} AS track_id,
              ${aeroswarmMovements.type} AS type,
              ${aeroswarmMovements.at} AS at,
              date_trunc('hour', ${aeroswarmMovements.at} AT TIME ZONE 'Asia/Jakarta') AS hour_local,
              COALESCE(
                NULLIF(${aeroswarmMovements.callsign}, ''),
                ${aeroswarmMovements.icao24},
                ${aeroswarmMovements.trackId}
              ) AS aircraft_label
            FROM ${aeroswarmMovements}
            WHERE ${movementWhereClause}
          ) m
          GROUP BY m.track_id, m.hour_local, m.type, m.aircraft_label
        ),
        track_hour AS (
          SELECT
            track_id,
            hour_local,
            COALESCE(sum(cnt) FILTER (WHERE type = 'takeoff'), 0)::int AS takeoff,
            COALESCE(sum(cnt) FILTER (WHERE type = 'landing'), 0)::int AS landing,
            max(aircraft_label) AS aircraft_label
          FROM ev
          GROUP BY track_id, hour_local
        ),
        bucket_track AS (
          SELECT
            ${movementBucketExpr} AS bucket,
            track_id,
            sum(takeoff)::int AS takeoff,
            sum(landing)::int AS landing,
            -- label dari jam paling awal track itu pada bucket (deterministik)
            (array_agg(aircraft_label ORDER BY hour_local))[1] AS aircraft_label
          FROM track_hour
          GROUP BY 1, track_id
        )
        SELECT
          'total'::text AS grp,
          NULL::text AS hour_bucket,
          NULL::text AS bucket,
          NULL::text AS aircraft_label,
          NULL::text AS movement_type,
          count(DISTINCT track_id)::int AS aircraft,
          COALESCE(sum(takeoff), 0)::int AS takeoff,
          COALESCE(sum(landing), 0)::int AS landing,
          NULL::int AS event_count,
          NULL::text AS last_at
        FROM track_hour

        UNION ALL

        SELECT
          'hour'::text,
          to_char(hour_local, 'YYYY-MM-DD"T"HH24:00'),
          NULL::text,
          NULL::text,
          NULL::text,
          count(*)::int,
          sum(takeoff)::int,
          sum(landing)::int,
          NULL::int,
          NULL::text
        FROM track_hour
        GROUP BY hour_local

        UNION ALL

        SELECT
          'bucket'::text,
          NULL::text,
          bucket,
          NULL::text,
          NULL::text,
          count(*)::int,
          sum(takeoff)::int,
          sum(landing)::int,
          NULL::int,
          NULL::text
        FROM bucket_track
        GROUP BY bucket

        UNION ALL

        SELECT
          'bucket_label'::text,
          NULL::text,
          bucket,
          aircraft_label,
          NULL::text,
          count(*)::int,
          NULL::int,
          NULL::int,
          NULL::int,
          NULL::text
        FROM bucket_track
        GROUP BY bucket, aircraft_label

        UNION ALL

        SELECT
          'bucket_type_label'::text,
          NULL::text,
          ${movementBucketExpr},
          aircraft_label,
          type::text,
          NULL::int,
          NULL::int,
          NULL::int,
          sum(cnt)::int,
          to_char(max(last_at) AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS')
        FROM ev
        WHERE type IN ('takeoff', 'landing')
        GROUP BY 3, 4, 5

        ORDER BY grp, hour_bucket
      `),
    ]);

  const movementAggRows = (movementAggResult as { rows: MovementAggQueryRow[] })
    .rows;
  const {
    totals: movementTotals,
    hourMap,
    bucketMap,
    peakHour: peakHourRow,
  } = parseMovementAggRows(movementAggRows);
  const bucketAlertMap = new Map(
    alertTrendRows.map((row) => [row.bucket, row.total]),
  );
  const alertDetailRows = (alertDetailResult as { rows: AlertDetailRow[] })
    .rows;
  // Satu kali pengelompokan kejadian untuk detail per kategori sekaligus ringkasan insiden.
  const { details: alertDetails, incidents: alertIncidents } =
    analyzeAlertRows(alertDetailRows);
  const alertTotals = buildAlertSummary(
    sumAlertTotals(alertTrendRows),
    alertDetails,
    alertIncidents,
  );
  const totalAircraft = movementTotals.aircraft;
  const totalTakeoff = movementTotals.takeoff;
  const totalLanding = movementTotals.landing;
  const totalGroundVehicle = 0; // no ground vehicle source yet
  const totalMovement = totalTakeoff + totalLanding;

  const rangeHours = Math.max(
    1,
    (rangeEndExclusive.getTime() - rangeStart.getTime()) / (1000 * 60 * 60),
  );
  const averageMovementPerHour =
    Math.round((totalMovement / rangeHours) * 100) / 100;

  const { averageTrafficPerHour, peakTrafficMovement, peakTrafficHour } =
    computeTrafficMetrics(hourMap, rangeHours);

  const trend = buildTrend(params, bucketMap, bucketAlertMap);

  return {
    period: params.period,
    startDate: params.startDate,
    endDate: params.endDate,
    ...(params.startTime && params.endTime
      ? { startTime: params.startTime, endTime: params.endTime }
      : {}),
    traffic: {
      totalAircraft,
      totalGroundVehicle,
      totalTraffic: totalAircraft + totalGroundVehicle,
      averageTrafficPerHour,
      peakTrafficMovement,
      peakTrafficHour,
    },
    movement: {
      totalTakeoff,
      totalLanding,
      averageMovementPerHour,
      peakHourMovement: peakHourRow?.movement ?? 0,
      peakHour: peakHourRow?.hour ?? null,
    },
    alerts: alertTotals,
    trend,
  };
}
