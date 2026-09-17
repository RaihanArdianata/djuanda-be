import { aeroswarmMovements, alerts, db } from "@repo/database";
import { and, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  computePeriodBuckets,
  exclusiveEndBoundaryJakarta,
  startOfDayJakarta,
} from "../lib/period";
import type { GetOperationalStatisticsParams } from "../validator/statistics.validator";
export interface AircraftMovementBreakdown {
  aircraft: string;
  count: number;
  at: string | null;
}

export interface OperationalTrendPoint {
  period: string;
  periodRange?: string;
  aircraft: number;
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
  alerts: AlertTotals;
  trend: OperationalTrendPoint[];
}

type MovementType = "takeoff" | "landing";
type MovementAggGroup = "total" | "hour_track" | "hour_aircraft";

interface MovementAggQueryRow {
  grp: MovementAggGroup;
  hour_bucket: string | null;
  track_id: string | null;
  aircraft: number | null;
  takeoff: number;
  landing: number;
  movement_type: MovementType | null;
  aircraft_label: string | null;
  event_count: number | null;
  aircraft_last_at: string | null;
  [column: string]: string | number | null;
}

interface MovementTotals {
  aircraft: number;
  takeoff: number;
  landing: number;
}

interface HourMovementEntry {
  trackIds: Set<string>;
  takeoff: number;
  landing: number;
}

interface AircraftStat {
  count: number;
  at: string | null;
}

interface HourAircraftEntry {
  takeoff: Map<string, AircraftStat>;
  landing: Map<string, AircraftStat>;
}

interface PeakHour {
  hour: string;
  movement: number;
}

interface ParsedMovementAgg {
  totals: MovementTotals;
  hourMovementMap: Map<string, HourMovementEntry>;
  hourAircraftMap: Map<string, HourAircraftEntry>;
  peakHour: PeakHour | null;
}

function applyTotalRow(totals: MovementTotals, row: MovementAggQueryRow): void {
  totals.aircraft = row.aircraft ?? 0;
  totals.takeoff = row.takeoff;
  totals.landing = row.landing;
}

function applyHourTrackRow(
  hourMovementMap: Map<string, HourMovementEntry>,
  row: MovementAggQueryRow,
): void {
  if (!(row.hour_bucket && row.track_id)) return;

  let entry = hourMovementMap.get(row.hour_bucket);
  if (!entry) {
    entry = { trackIds: new Set<string>(), takeoff: 0, landing: 0 };
    hourMovementMap.set(row.hour_bucket, entry);
  }
  entry.trackIds.add(row.track_id);
  entry.takeoff += row.takeoff;
  entry.landing += row.landing;
}

function applyHourAircraftRow(
  hourAircraftMap: Map<string, HourAircraftEntry>,
  row: MovementAggQueryRow,
): void {
  if (!(row.hour_bucket && row.movement_type && row.aircraft_label)) return;

  let entry = hourAircraftMap.get(row.hour_bucket);
  if (!entry) {
    entry = {
      takeoff: new Map<string, AircraftStat>(),
      landing: new Map<string, AircraftStat>(),
    };
    hourAircraftMap.set(row.hour_bucket, entry);
  }
  entry[row.movement_type].set(row.aircraft_label, {
    count: row.event_count ?? 0,
    at: row.aircraft_last_at ?? null,
  });
}

function computePeakHour(
  hourMovementMap: Map<string, HourMovementEntry>,
): PeakHour | null {
  let peak: PeakHour | null = null;
  for (const [hour, entry] of hourMovementMap) {
    const movement = entry.takeoff + entry.landing;
    if (!peak || movement > peak.movement) {
      peak = { hour, movement };
    }
  }
  return peak;
}
function computePeakTrafficHour(
  hourMovementMap: Map<string, HourMovementEntry>,
): PeakHour | null {
  let peak: PeakHour | null = null;
  for (const [hour, entry] of hourMovementMap) {
    const aircraftCount = entry.trackIds.size;
    if (!peak || aircraftCount > peak.movement) {
      peak = { hour, movement: aircraftCount };
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
  hourMovementMap: Map<string, HourMovementEntry>,
  rangeHours: number,
): TrafficMetrics {
  let sumHourlyAircraft = 0;
  for (const entry of hourMovementMap.values()) {
    sumHourlyAircraft += entry.trackIds.size;
  }

  const peak = computePeakTrafficHour(hourMovementMap);

  return {
    averageTrafficPerHour:
      Math.round((sumHourlyAircraft / rangeHours) * 100) / 100,
    peakTrafficMovement: peak?.movement ?? 0,
    peakTrafficHour: peak?.hour ?? null,
  };
}

export function parseMovementAggRows(
  rows: MovementAggQueryRow[],
): ParsedMovementAgg {
  const totals: MovementTotals = { aircraft: 0, takeoff: 0, landing: 0 };
  const hourMovementMap = new Map<string, HourMovementEntry>();
  const hourAircraftMap = new Map<string, HourAircraftEntry>();

  for (const row of rows) {
    switch (row.grp) {
      case "total":
        applyTotalRow(totals, row);
        break;
      case "hour_track":
        applyHourTrackRow(hourMovementMap, row);
        break;
      case "hour_aircraft":
        applyHourAircraftRow(hourAircraftMap, row);
        break;
    }
  }

  return {
    totals,
    hourMovementMap,
    hourAircraftMap,
    peakHour: computePeakHour(hourMovementMap),
  };
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

function latestAt(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function mergeAircraftCounts(
  target: Map<string, AircraftStat>,
  source: Map<string, AircraftStat>,
): void {
  for (const [aircraft, stat] of source) {
    const existing = target.get(aircraft);
    target.set(aircraft, {
      count: (existing?.count ?? 0) + stat.count,
      at: latestAt(existing?.at ?? null, stat.at),
    });
  }
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

export function buildTrend(
  params: GetOperationalStatisticsParams,
  hourMovementMap: Map<string, HourMovementEntry>,
  hourAlertMap: Map<string, number>,
  hourAircraftMap: Map<string, HourAircraftEntry>,
): OperationalTrendPoint[] {
  const buckets = computePeriodBuckets(
    params.period,
    params.startDate,
    params.endDate,
    params.startTime,
    params.endTime,
  );

  return buckets.map(({ period, periodStart, periodEnd, hourKeys }) => {
    const trackIds = new Set<string>();
    const takeoffAircraftCounts = new Map<string, AircraftStat>();
    const landingAircraftCounts = new Map<string, AircraftStat>();
    let takeoff = 0;
    let landing = 0;
    let alertCount = 0;

    for (const hourKey of hourKeys) {
      const movement = hourMovementMap.get(hourKey);
      if (movement) {
        for (const trackId of movement.trackIds) trackIds.add(trackId);
        takeoff += movement.takeoff;
        landing += movement.landing;
      }

      alertCount += hourAlertMap.get(hourKey) ?? 0;

      const aircraftEntry = hourAircraftMap.get(hourKey);
      if (aircraftEntry) {
        mergeAircraftCounts(takeoffAircraftCounts, aircraftEntry.takeoff);
        mergeAircraftCounts(landingAircraftCounts, aircraftEntry.landing);
      }
    }

    const point: OperationalTrendPoint = {
      period,
      aircraft: trackIds.size,
      groundVehicle: 0,
      takeoff,
      landing,
      totalMovement: takeoff + landing,
      alerts: alertCount,
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

export async function getOperationalStatistics(
  params: GetOperationalStatisticsParams,
): Promise<OperationalStatisticsResult> {
  const rangeStart = startOfDayJakarta(params.startDate);
  const rangeEndExclusive = exclusiveEndBoundaryJakarta(params.endDate);

  const alertWhereClause = timeRangeWhere(
    alerts.triggeredAt,
    alerts.airportId,
    rangeStart,
    rangeEndExclusive,
    params.airportId,
    timeOfDayWhere(alerts.triggeredAt, params.startTime, params.endTime),
  );

  const movementWhereClause = timeRangeWhere(
    aeroswarmMovements.at,
    aeroswarmMovements.airportId,
    rangeStart,
    rangeEndExclusive,
    params.airportId,
    timeOfDayWhere(aeroswarmMovements.at, params.startTime, params.endTime),
  );
  const alertBucketExpr = sql<string>`to_char(date_trunc('hour', ${alerts.triggeredAt} at time zone 'Asia/Jakarta'), 'YYYY-MM-DD"T"HH24:00')`;
  const typeFilter = (alertType: string): SQL<number> =>
    sql<number>`count(*) filter (where upper(${alerts.type}) = ${alertType})::int`;

  const [alertTrendRows, movementAggResult] = await db.transaction(
    async (tx) => {
      await tx.execute(sql`SET LOCAL work_mem = '128MB'`);
      await tx.execute(sql`SET LOCAL max_parallel_workers_per_gather = 4`);

      return Promise.all([
        tx
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
        tx.execute<MovementAggQueryRow>(sql`
        WITH movement_base AS MATERIALIZED (
          SELECT
            ${aeroswarmMovements.trackId} AS track_id,
            ${aeroswarmMovements.type} AS type,
            ${aeroswarmMovements.at} AS at,
            date_trunc('hour', ${aeroswarmMovements.at} AT TIME ZONE 'Asia/Jakarta') AS hour_raw,
            COALESCE(
              NULLIF(${aeroswarmMovements.callsign}, ''),
              ${aeroswarmMovements.icao24},
              ${aeroswarmMovements.trackId}
            ) AS aircraft_label
          FROM ${aeroswarmMovements}
          WHERE ${movementWhereClause}
        ),
        track_hour_agg AS MATERIALIZED (
          SELECT
            track_id,
            hour_raw,
            count(*) FILTER (WHERE type = 'takeoff')::int AS takeoff,
            count(*) FILTER (WHERE type = 'landing')::int AS landing
          FROM movement_base
          GROUP BY track_id, hour_raw
        ),
        grand_total AS (
          SELECT
            count(DISTINCT track_id)::int AS aircraft,
            sum(takeoff)::int AS takeoff,
            sum(landing)::int AS landing
          FROM track_hour_agg
        ),
        hour_type_aircraft AS (
          SELECT
            hour_raw,
            type,
            aircraft_label,
            count(*)::int AS event_count,
            max(at) AS last_at
          FROM movement_base
          GROUP BY hour_raw, type, aircraft_label
        )
        SELECT
          'hour_track' AS grp,
          to_char(hour_raw, 'YYYY-MM-DD"T"HH24:00') AS hour_bucket,
          track_id::text AS track_id,
          NULL::int AS aircraft,
          takeoff,
          landing,
          NULL::text AS movement_type,
          NULL::text AS aircraft_label,
          NULL::int AS event_count,
          NULL::text AS aircraft_last_at
        FROM track_hour_agg

        UNION ALL

        SELECT
          'total' AS grp,
          NULL::text AS hour_bucket,
          NULL::text AS track_id,
          aircraft,
          takeoff,
          landing,
          NULL::text AS movement_type,
          NULL::text AS aircraft_label,
          NULL::int AS event_count,
          NULL::text AS aircraft_last_at
        FROM grand_total

        UNION ALL

        SELECT
          'hour_aircraft' AS grp,
          to_char(hour_raw, 'YYYY-MM-DD"T"HH24:00') AS hour_bucket,
          NULL::text AS track_id,
          NULL::int AS aircraft,
          0 AS takeoff,
          0 AS landing,
          type AS movement_type,
          aircraft_label,
          event_count,
          to_char(last_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD"T"HH24:MI:SS') AS aircraft_last_at
        FROM hour_type_aircraft
      `),
      ]);
    },
  );
  const movementAggRows = (movementAggResult as { rows: MovementAggQueryRow[] })
    .rows;
  const {
    totals: movementTotals,
    hourMovementMap,
    hourAircraftMap,
    peakHour: peakHourRow,
  } = parseMovementAggRows(movementAggRows);
  const hourAlertMap = new Map(
    alertTrendRows.map((row) => [row.bucket, row.total]),
  );
  const alertTotals = sumAlertTotals(alertTrendRows);
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
    computeTrafficMetrics(hourMovementMap, rangeHours);

  const trend = buildTrend(
    params,
    hourMovementMap,
    hourAlertMap,
    hourAircraftMap,
  );

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
