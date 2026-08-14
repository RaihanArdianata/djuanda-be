import { aeroswarmAlerts, aeroswarmMovements, db } from "@repo/database";
import { and, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  computePeriodBuckets,
  enumerateDaysInclusive,
  exclusiveEndBoundaryJakarta,
  startOfDayJakarta,
} from "../lib/period";
import type { GetOperationalStatisticsParams } from "../validator/statistics.validator";

export interface OperationalTrendPoint {
  period: string;
  periodRange?: string;
  aircraft: number;
  groundVehicle: number;
  takeoff: number;
  landing: number;
  totalMovement: number;
  alerts: number;
}

export interface OperationalStatisticsResult {
  period: GetOperationalStatisticsParams["period"];
  startDate: string;
  endDate: string;
  traffic: {
    totalAircraft: number;
    totalGroundVehicle: number;
    totalTraffic: number;
  };
  movement: {
    totalTakeoff: number;
    totalLanding: number;
    averageMovementPerHour: number;
    peakHourMovement: number;
    peakHour: string | null;
  };
  alerts: {
    stca: number;
    apa: number;
    da: number;
    ria: number;
    taia: number;
    total: number;
  };
  trend: OperationalTrendPoint[];
}

type MovementType = "takeoff" | "landing";
type MovementAggGroup = "period" | "hour" | "total";
interface MovementAggQueryRow {
  grp: MovementAggGroup;
  period_bucket: string | null;
  hour_bucket: string | null;
  track_id: string | null;
  aircraft: number | null;
  takeoff: number;
  landing: number;
  [column: string]: string | number | null;
}

interface MovementTotals {
  aircraft: number;
  takeoff: number;
  landing: number;
}

interface DayMovementEntry {
  trackIds: Set<string>;
  takeoff: number;
  landing: number;
}

interface PeakHour {
  hour: string;
  movement: number;
}

interface ParsedMovementAgg {
  totals: MovementTotals;
  dayMovementMap: Map<string, DayMovementEntry>;
  peakHour: PeakHour | null;
}

function applyTotalRow(totals: MovementTotals, row: MovementAggQueryRow): void {
  totals.aircraft = row.aircraft ?? 0;
  totals.takeoff = row.takeoff;
  totals.landing = row.landing;
}

function applyPeriodRow(
  dayMovementMap: Map<string, DayMovementEntry>,
  row: MovementAggQueryRow,
): void {
  if (!(row.period_bucket && row.track_id)) return;

  let entry = dayMovementMap.get(row.period_bucket);
  if (!entry) {
    entry = { trackIds: new Set<string>(), takeoff: 0, landing: 0 };
    dayMovementMap.set(row.period_bucket, entry);
  }
  entry.trackIds.add(row.track_id);
  entry.takeoff += row.takeoff;
  entry.landing += row.landing;
}

function applyHourRow(
  currentPeak: PeakHour | null,
  row: MovementAggQueryRow,
): PeakHour | null {
  if (!row.hour_bucket) return currentPeak;

  const movement = row.takeoff + row.landing;
  if (!currentPeak || movement > currentPeak.movement) {
    return { hour: row.hour_bucket, movement };
  }
  return currentPeak;
}

function parseMovementAggRows(rows: MovementAggQueryRow[]): ParsedMovementAgg {
  const totals: MovementTotals = { aircraft: 0, takeoff: 0, landing: 0 };
  const dayMovementMap = new Map<string, DayMovementEntry>();
  let peakHour: PeakHour | null = null;

  for (const row of rows) {
    switch (row.grp) {
      case "total":
        applyTotalRow(totals, row);
        break;
      case "period":
        applyPeriodRow(dayMovementMap, row);
        break;
      case "hour":
        peakHour = applyHourRow(peakHour, row);
        break;
    }
  }

  return { totals, dayMovementMap, peakHour };
}
interface AlertTrendRow {
  bucket: string;
  total: number;
  stca: number;
  apa: number;
  da: number;
  ria: number;
  taia: number;
}

interface AlertTotals {
  total: number;
  stca: number;
  apa: number;
  da: number;
  ria: number;
  taia: number;
}

function sumAlertTotals(alertTrendRows: AlertTrendRow[]): AlertTotals {
  return alertTrendRows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      stca: acc.stca + row.stca,
      apa: acc.apa + row.apa,
      da: acc.da + row.da,
      ria: acc.ria + row.ria,
      taia: acc.taia + row.taia,
    }),
    { total: 0, stca: 0, apa: 0, da: 0, ria: 0, taia: 0 },
  );
}

function timeRangeWhere(
  timeColumn: PgColumn,
  airportColumn: PgColumn,
  rangeStart: Date,
  rangeEndExclusive: Date,
  airportId: string | undefined,
): SQL | undefined {
  const conditions: SQL[] = [
    gte(timeColumn, rangeStart),
    lt(timeColumn, rangeEndExclusive),
  ];
  if (airportId) {
    conditions.push(eq(airportColumn, airportId));
  }
  return and(...conditions);
}
function buildTrend(
  params: GetOperationalStatisticsParams,
  dayMovementMap: Map<string, DayMovementEntry>,
  dayAlertMap: Map<string, number>,
): OperationalTrendPoint[] {
  const buckets = computePeriodBuckets(
    params.period,
    params.startDate,
    params.endDate,
  );

  return buckets.map(({ period, periodStart, periodEnd }) => {
    const trackIds = new Set<string>();
    let takeoff = 0;
    let landing = 0;
    let alerts = 0;

    for (const day of enumerateDaysInclusive(periodStart, periodEnd)) {
      const movement = dayMovementMap.get(day);
      if (movement) {
        for (const trackId of movement.trackIds) trackIds.add(trackId);
        takeoff += movement.takeoff;
        landing += movement.landing;
      }
      alerts += dayAlertMap.get(day) ?? 0;
    }

    const point: OperationalTrendPoint = {
      period,
      aircraft: trackIds.size,
      groundVehicle: 0,
      takeoff,
      landing,
      totalMovement: takeoff + landing,
      alerts,
    };
    if (params.period !== "daily") {
      point.periodRange = `${periodStart} - ${periodEnd}`;
    }
    return point;
  });
}

export async function getOperationalStatistics(
  params: GetOperationalStatisticsParams,
): Promise<OperationalStatisticsResult> {
  const rangeStart = startOfDayJakarta(params.startDate);
  const rangeEndExclusive = exclusiveEndBoundaryJakarta(params.endDate);

  const alertWhereClause = timeRangeWhere(
    aeroswarmAlerts.triggeredAt,
    aeroswarmAlerts.airportId,
    rangeStart,
    rangeEndExclusive,
    params.airportId,
  );

  const movementWhereClause = timeRangeWhere(
    aeroswarmMovements.at,
    aeroswarmMovements.airportId,
    rangeStart,
    rangeEndExclusive,
    params.airportId,
  );
  const alertBucketExpr = sql<string>`to_char(date_trunc('day', ${aeroswarmAlerts.triggeredAt} at time zone 'Asia/Jakarta'), 'YYYY-MM-DD')`;
  const categoryFilter = (category: string): SQL<number> =>
    sql<number>`count(*) filter (where upper(${aeroswarmAlerts.type}) = ${category})::int`;

  const movementTypeFilter = (type: MovementType): SQL<number> =>
    sql<number>`count(*) filter (where ${aeroswarmMovements.type} = ${type})::int`;
  const [alertTrendRows, movementAggResult] = await db.transaction(
    async (tx) => {
      await tx.execute(sql`SET LOCAL work_mem = '128MB'`);
      await tx.execute(sql`SET LOCAL max_parallel_workers_per_gather = 4`);

      return Promise.all([
        tx
          .select({
            bucket: alertBucketExpr,
            total: sql<number>`count(*)::int`,
            stca: categoryFilter("STCA"),
            apa: categoryFilter("APA"),
            da: categoryFilter("DA"),
            ria: categoryFilter("RIA"),
            taia: categoryFilter("TAIA"),
          })
          .from(aeroswarmAlerts)
          .where(alertWhereClause)
          .groupBy(sql`1`),
        tx.execute<MovementAggQueryRow>(sql`
        WITH movement_agg AS MATERIALIZED (
          SELECT
            ${aeroswarmMovements.trackId} AS track_id,
            date_trunc('day', ${aeroswarmMovements.at} AT TIME ZONE 'Asia/Jakarta') AS day_raw,
            date_trunc('hour', ${aeroswarmMovements.at} AT TIME ZONE 'Asia/Jakarta') AS hour_raw,
            ${movementTypeFilter("takeoff")} AS takeoff,
            ${movementTypeFilter("landing")} AS landing
          FROM ${aeroswarmMovements}
          WHERE ${movementWhereClause}
          GROUP BY track_id, day_raw, hour_raw
        ),
        per_track_day AS (
          SELECT
            track_id,
            day_raw,
            sum(takeoff)::int AS takeoff,
            sum(landing)::int AS landing
          FROM movement_agg
          GROUP BY track_id, day_raw
        ),
        per_hour AS (
          SELECT
            hour_raw,
            sum(takeoff)::int AS takeoff,
            sum(landing)::int AS landing
          FROM movement_agg
          GROUP BY hour_raw
        ),
        grand_total AS (
          SELECT
            count(DISTINCT track_id)::int AS aircraft,
            sum(takeoff)::int AS takeoff,
            sum(landing)::int AS landing
          FROM movement_agg
        )
        SELECT
          'period' AS grp,
          to_char(day_raw, 'YYYY-MM-DD') AS period_bucket,
          NULL::text AS hour_bucket,
          track_id::text AS track_id,
          NULL::int AS aircraft,
          takeoff,
          landing
        FROM per_track_day

        UNION ALL

        SELECT
          'hour' AS grp,
          NULL::text AS period_bucket,
          to_char(hour_raw, 'YYYY-MM-DD"T"HH24:00') AS hour_bucket,
          NULL::text AS track_id,
          NULL::int AS aircraft,
          takeoff,
          landing
        FROM per_hour

        UNION ALL

        SELECT
          'total' AS grp,
          NULL::text AS period_bucket,
          NULL::text AS hour_bucket,
          NULL::text AS track_id,
          aircraft,
          takeoff,
          landing
        FROM grand_total
      `),
      ]);
    },
  );
  const movementAggRows = (movementAggResult as { rows: MovementAggQueryRow[] })
    .rows;
  const {
    totals: movementTotals,
    dayMovementMap,
    peakHour: peakHourRow,
  } = parseMovementAggRows(movementAggRows);

  // ---------- Alerts aggregation ----------
  const dayAlertMap = new Map(
    alertTrendRows.map((row) => [row.bucket, row.total]),
  );
  const alertTotals = sumAlertTotals(alertTrendRows);

  // ---------- Traffic & Movement aggregation ----------
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

  const trend = buildTrend(params, dayMovementMap, dayAlertMap);

  return {
    period: params.period,
    startDate: params.startDate,
    endDate: params.endDate,
    traffic: {
      totalAircraft,
      totalGroundVehicle,
      totalTraffic: totalAircraft + totalGroundVehicle,
    },
    movement: {
      totalTakeoff,
      totalLanding,
      averageMovementPerHour,
      peakHourMovement: peakHourRow?.movement ?? 0,
      peakHour: peakHourRow?.hour ?? null,
    },
    alerts: {
      stca: alertTotals.stca,
      apa: alertTotals.apa,
      da: alertTotals.da,
      ria: alertTotals.ria,
      taia: alertTotals.taia,
      total: alertTotals.total,
    },
    trend,
  };
}
