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
interface TrackAggRow {
  grp: 0 | 1 | 2;
  period_bucket: string | null;
  hour_bucket: string | null;
  aircraft: number | null;
  takeoff: number;
  landing: number;
  [key: string]: unknown;
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
  const categoryFilter = (category: string) =>
    sql<number>`count(*) filter (where upper(${aeroswarmAlerts.type}) = ${category})::int`;
  const [alertTrendRows, trackAggResult] = await db.transaction(async (tx) => {
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

  const totalsRow = rows.find((r) => r.grp === 2);
  const trackTotals = {
    aircraft: totalsRow?.aircraft ?? 0,
    takeoff: totalsRow?.takeoff ?? 0,
    landing: totalsRow?.landing ?? 0,
  };

  const trackTrendMap = new Map(
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

  let peakHourRow: { hour: string; movement: number } | null = null;
  for (const r of rows) {
    if (r.grp !== 1) continue;
    const movement = r.takeoff + r.landing;
    if (!peakHourRow || movement > peakHourRow.movement) {
      peakHourRow = { hour: r.hour_bucket as string, movement };
    }
  }

  // ---------- Alerts aggregation ----------
  const alertTrendMap = new Map(
    alertTrendRows.map((row) => [row.bucket, row.total]),
  );
  const alertTotals = alertTrendRows.reduce(
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
  const mappedAlerts =
    alertTotals.stca +
    alertTotals.apa +
    alertTotals.da +
    alertTotals.ria +
    alertTotals.taia;
  const unmappedAlertCount = alertTotals.total - mappedAlerts;

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

  // ---------- Assemble trend ----------
  const trend: OperationalTrendPoint[] = listBucketKeys(
    params.period,
    params.startDate,
    params.endDate,
  ).map((bucket) => {
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
  });

  const warnings: string[] = [];
  if (unmappedAlertCount > 0) {
    warnings.push(unmappedAlertTypeWarning(unmappedAlertCount));
  }
  if (totalAircraft > 0 && totalMovement === 0) {
    warnings.push(
      "totalTakeoff and totalLanding are both 0 even though aircraft were tracked in this range: aeroswarm_tracks.on_ground has no true/false values yet for this period (still null from the source feed). Figures will populate automatically once the feed starts sending on_ground.",
    );
  }

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