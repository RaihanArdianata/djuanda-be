import { aeroswarmAlerts, aeroswarmTracks, db } from "@repo/database";
import { and, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import {
  exclusiveEndBoundaryJakarta,
  listBucketKeys,
  startOfDayJakarta,
  truncUnitFor,
} from "../lib/period";
import type { GetOperationalStatisticsParams } from "../validator/statistics.validator";

const unmappedAlertTypeWarning = (unmappedCount: number): string =>
  `${unmappedCount} alert(s) in this range have an aeroswarm_alerts.type value outside the five known categories (STCA/APA/DA/RIA/TAIA) and are counted in alerts.total but not in any category breakdown. See src/modules/statistics/contract/aeroswarm-contract.ts.`;

export interface OperationalTrendPoint {
  period: string;
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
  warnings: string[];
}

/**
 * Row shape returned by the track aggregation query.
 *
 * grp discriminates which aggregation level a row belongs to:
 *   0 = per-period   (period_bucket populated, hour_bucket null, aircraft populated)
 *   1 = per-hour      (hour_bucket populated, period_bucket null, aircraft null — not needed for peak-hour calc)
 *   2 = grand total   (both buckets null, aircraft populated)
 */
interface TrackAggRow {
  grp: 0 | 1 | 2;
  period_bucket: string | null;
  hour_bucket: string | null;
  aircraft: number | null;
  takeoff: number;
  landing: number;
  [key: string]: unknown;
}

interface TrackTotals {
  aircraft: number;
  takeoff: number;
  landing: number;
}

interface TrackTrendEntry {
  aircraft: number;
  takeoff: number;
  landing: number;
}

interface PeakHour {
  hour: string;
  movement: number;
}

interface ParsedTrackAgg {
  totals: TrackTotals;
  trendMap: Map<string, TrackTrendEntry>;
  peakHour: PeakHour | null;
}

/**
 * Splits the flat grp-discriminated row set (see TrackAggRow) back into the
 * three shapes the rest of the function needs: grand totals, a per-period
 * trend map, and the single highest-movement hour. Pulled out on its own so
 * getOperationalStatistics stays under the cognitive-complexity budget.
 */
function parseTrackAggRows(rows: TrackAggRow[]): ParsedTrackAgg {
  const totalsRow = rows.find((r) => r.grp === 2);
  const totals: TrackTotals = {
    aircraft: totalsRow?.aircraft ?? 0,
    takeoff: totalsRow?.takeoff ?? 0,
    landing: totalsRow?.landing ?? 0,
  };

  const trendMap = new Map<string, TrackTrendEntry>(
    rows
      .filter((r) => r.grp === 0)
      .map((r) => [
        r.period_bucket as string,
        {
          aircraft: r.aircraft ?? 0,
          takeoff: r.takeoff,
          landing: r.landing,
        },
      ]),
  );

  let peakHour: PeakHour | null = null;
  for (const r of rows) {
    if (r.grp !== 1) continue;
    const movement = r.takeoff + r.landing;
    if (!peakHour || movement > peakHour.movement) {
      peakHour = { hour: r.hour_bucket as string, movement };
    }
  }

  return { totals, trendMap, peakHour };
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

function buildWarnings(
  alertTotals: AlertTotals,
  totalAircraft: number,
  totalMovement: number,
): string[] {
  const warnings: string[] = [];

  const mappedAlerts =
    alertTotals.stca +
    alertTotals.apa +
    alertTotals.da +
    alertTotals.ria +
    alertTotals.taia;
  const unmappedAlertCount = alertTotals.total - mappedAlerts;
  if (unmappedAlertCount > 0) {
    warnings.push(unmappedAlertTypeWarning(unmappedAlertCount));
  }

  if (totalAircraft > 0 && totalMovement === 0) {
    warnings.push(
      "totalTakeoff and totalLanding are both 0 even though aircraft were tracked in this range: aeroswarm_tracks.on_ground has no true/false values yet for this period (still null from the source feed). Figures will populate automatically once the feed starts sending on_ground.",
    );
  }

  return warnings;
}

function buildTrend(
  params: GetOperationalStatisticsParams,
  trackTrendMap: Map<string, TrackTrendEntry>,
  alertTrendMap: Map<string, number>,
): OperationalTrendPoint[] {
  return listBucketKeys(params.period, params.startDate, params.endDate).map(
    (bucket) => {
      const track = trackTrendMap.get(bucket);
      const takeoff = track?.takeoff ?? 0;
      const landing = track?.landing ?? 0;
      return {
        period: bucket,
        aircraft: track?.aircraft ?? 0,
        groundVehicle: 0,
        takeoff,
        landing,
        totalMovement: takeoff + landing,
        alerts: alertTrendMap.get(bucket) ?? 0,
      };
    },
  );
}

export async function getOperationalStatistics(
  params: GetOperationalStatisticsParams,
): Promise<OperationalStatisticsResult> {
  const rangeStart = startOfDayJakarta(params.startDate);
  const rangeEndExclusive = exclusiveEndBoundaryJakarta(params.endDate);
  const unit = truncUnitFor(params.period);
  const unitRaw = sql.raw(`'${unit}'`);

  // ---------- WHERE clauses ----------
  const alertConditions: SQL[] = [
    gte(aeroswarmAlerts.triggeredAt, rangeStart),
    lt(aeroswarmAlerts.triggeredAt, rangeEndExclusive),
  ];
  if (params.airportId) {
    alertConditions.push(eq(aeroswarmAlerts.airportId, params.airportId));
  }
  const alertWhereClause = and(...alertConditions);

  const trackConditions: SQL[] = [
    gte(aeroswarmTracks.fusedAt, rangeStart),
    lt(aeroswarmTracks.fusedAt, rangeEndExclusive),
  ];
  if (params.airportId) {
    trackConditions.push(eq(aeroswarmTracks.airportId, params.airportId));
  }
  const trackWhereClause = and(...trackConditions);

  const alertBucketExpr = sql<string>`to_char(date_trunc(${unitRaw}, ${aeroswarmAlerts.triggeredAt} at time zone 'Asia/Jakarta'), 'YYYY-MM-DD')`;
  const categoryFilter = (category: string): SQL<number> =>
    sql<number>`count(*) filter (where upper(${aeroswarmAlerts.type}) = ${category})::int`;

  // ---------- Aggregation ----------
  // Both queries run inside a transaction so `SET LOCAL work_mem` only
  // affects this request's connection and is automatically reverted when
  // the transaction ends — no schema/index changes, no pool-wide side effects.
  const [alertTrendRows, trackAggResult] = await db.transaction(async (tx) => {
    // Track aggregation groups by track_id first (still using the existing
    // aeroswarm_tracks_airport_idx (airport_id, fused_at) index scan for the
    // WHERE filter), which can spill to disk on large date ranges under the
    // default work_mem. Bump it for just this transaction.
    await tx.execute(sql`SET LOCAL work_mem = '128MB'`);

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

      // ---------- Track aggregation (index-scan filter, then aggregate once) ----------
      //
      // Rationale for this shape vs. the previous single GROUPING SETS query:
      //
      // `GROUPING SETS ((), (period_raw), (hour_raw))` combined with
      // `count(distinct track_id)` cannot be computed in one pass by Postgres —
      // a DISTINCT aggregate can't be shared across grouping sets, so the
      // planner re-materializes and re-sorts the *entire* filtered row set once
      // per grouping set (3x over potentially millions of raw fused rows).
      //
      // Fix: pre-aggregate to (track_id, period_raw, hour_raw) once in a
      // MATERIALIZED CTE — this still does exactly one index scan + filter
      // over aeroswarm_tracks (same cost as before for that part), but
      // collapses many raw fused-at rows per track into a single row per
      // (track, bucket). Everything downstream (per-period distinct count,
      // per-hour sums, grand totals) then operates on that much smaller,
      // pre-aggregated set instead of the raw row count — and MATERIALIZED
      // guarantees Postgres computes it once and reuses it for all three
      // downstream branches instead of inlining/re-scanning per branch.
      tx.execute<TrackAggRow>(sql`
        WITH track_agg AS MATERIALIZED (
          SELECT
            ${aeroswarmTracks.trackId} AS track_id,
            date_trunc(${unitRaw}, ${aeroswarmTracks.fusedAt} AT TIME ZONE 'Asia/Jakarta') AS period_raw,
            date_trunc('hour', ${aeroswarmTracks.fusedAt} AT TIME ZONE 'Asia/Jakarta') AS hour_raw,
            count(*) FILTER (WHERE ${aeroswarmTracks.onGround} = false)::int AS takeoff,
            count(*) FILTER (WHERE ${aeroswarmTracks.onGround} = true)::int AS landing
          FROM ${aeroswarmTracks}
          WHERE ${trackWhereClause}
          GROUP BY track_id, period_raw, hour_raw
        ),
        per_period AS (
          SELECT
            period_raw,
            count(DISTINCT track_id)::int AS aircraft,
            sum(takeoff)::int AS takeoff,
            sum(landing)::int AS landing
          FROM track_agg
          GROUP BY period_raw
        ),
        per_hour AS (
          SELECT
            hour_raw,
            sum(takeoff)::int AS takeoff,
            sum(landing)::int AS landing
          FROM track_agg
          GROUP BY hour_raw
        ),
        grand_total AS (
          SELECT
            count(DISTINCT track_id)::int AS aircraft,
            sum(takeoff)::int AS takeoff,
            sum(landing)::int AS landing
          FROM track_agg
        )
        SELECT
          0 AS grp,
          to_char(period_raw, 'YYYY-MM-DD') AS period_bucket,
          NULL::text AS hour_bucket,
          aircraft,
          takeoff,
          landing
        FROM per_period

        UNION ALL

        SELECT
          1 AS grp,
          NULL::text AS period_bucket,
          to_char(hour_raw, 'YYYY-MM-DD"T"HH24:00') AS hour_bucket,
          NULL::int AS aircraft,
          takeoff,
          landing
        FROM per_hour

        UNION ALL

        SELECT
          2 AS grp,
          NULL::text AS period_bucket,
          NULL::text AS hour_bucket,
          aircraft,
          takeoff,
          landing
        FROM grand_total
      `),
    ]);
  });

  // Driver-shape note: node-postgres (`pg`) via drizzle-orm/node-postgres
  const rows = (trackAggResult as unknown as { rows: TrackAggRow[] }).rows;
  const {
    totals: trackTotals,
    trendMap: trackTrendMap,
    peakHour: peakHourRow,
  } = parseTrackAggRows(rows);

  // ---------- Alerts aggregation ----------
  const alertTrendMap = new Map(
    alertTrendRows.map((row) => [row.bucket, row.total]),
  );
  const alertTotals = sumAlertTotals(alertTrendRows);

  // ---------- Traffic & Movement aggregation ----------
  const totalAircraft = trackTotals.aircraft;
  const totalTakeoff = trackTotals.takeoff;
  const totalLanding = trackTotals.landing;
  const totalGroundVehicle = 0; // no ground vehicle source yet
  const totalMovement = totalTakeoff + totalLanding;

  const rangeHours = Math.max(
    1,
    (rangeEndExclusive.getTime() - rangeStart.getTime()) / (1000 * 60 * 60),
  );
  const averageMovementPerHour =
    Math.round((totalMovement / rangeHours) * 100) / 100;

  const trend = buildTrend(params, trackTrendMap, alertTrendMap);
  const warnings = buildWarnings(alertTotals, totalAircraft, totalMovement);

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
    warnings,
  };
}
