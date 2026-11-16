import type {
  AlertSummary,
  OperationalStatisticsResult,
  OperationalTrendPoint,
} from "../service/statistics.service";
import type { AlertDetail } from "./alert-detail";
import { ALERT_CATEGORIES, type AlertCategoryKey } from "./report-format";

/** Angka turunan yang dipakai beberapa sheet sekaligus; dihitung sekali di sini. */
export interface CategoryStat {
  key: AlertCategoryKey;
  label: string;
  count: number;
  critical: number;
  warning: number;
  /** Alert Info: untuk diketahui, bukan untuk ditindak. */
  info: number;
}

export interface RankedItem {
  name: string;
  count: number;
}

export interface ReportStats {
  totalMovement: number;
  /** Titik tren dengan pergerakan terbanyak; null bila semuanya 0. */
  peakMovement: OperationalTrendPoint | null;
  /** Titik tren dengan alert terbanyak; null bila tidak ada alert. */
  peakAlert: OperationalTrendPoint | null;
  categories: CategoryStat[];
  alertCritical: number;
  alertWarning: number;
  alertInfo: number;
  dominantCategory: CategoryStat | null;
  topAircraft: RankedItem[];
  topAlertCallsigns: RankedItem[];
  groundVehicleAvailable: boolean;
}

const TOP_N = 10;

function maxBy<T>(items: T[], value: (item: T) => number): T | null {
  let best: T | null = null;
  let bestValue = 0;
  for (const item of items) {
    const v = value(item);
    if (v > bestValue) {
      best = item;
      bestValue = v;
    }
  }
  return best;
}

export function rank(counts: Map<string, number>, limit = TOP_N): RankedItem[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function categoryStat(
  key: AlertCategoryKey,
  label: string,
  alerts: AlertSummary,
): CategoryStat {
  const details = alerts[key].details;
  const bySeverity = (severity: string): number =>
    details.filter((d) => d.severity.toUpperCase() === severity).length;
  return {
    key,
    label,
    count: alerts[key].count,
    critical: bySeverity("CRITICAL"),
    warning: bySeverity("WARNING"),
    info: bySeverity("INFO"),
  };
}

/**
 * Semua detail alert dari kelima kategori. Alert satu kejadian berdampingan: kejadian terbaru di atas, dan di dalam kejadian
 * alert terlama dahulu supaya urutannya terbaca sebagai kronologi.
 */
export function allAlertDetails(
  alerts: AlertSummary,
): Array<AlertDetail & { category: string }> {
  const rows: Array<AlertDetail & { category: string }> = [];
  for (const { key, label } of ALERT_CATEGORIES) {
    for (const detail of alerts[key].details) {
      rows.push({ ...detail, category: label });
    }
  }
  const latest = (d: AlertDetail): number =>
    d.incident?.endAt ?? Date.parse(d.time);
  return rows.sort((a, b) => {
    const byIncident = latest(b) - latest(a);
    if (byIncident !== 0) return byIncident;
    if (a.incident && b.incident) {
      return (
        a.incident.number - b.incident.number ||
        a.incident.position - b.incident.position
      );
    }
    return b.time.localeCompare(a.time);
  });
}

export function deriveReportStats(
  result: OperationalStatisticsResult,
): ReportStats {
  const categories = ALERT_CATEGORIES.map(({ key, label }) =>
    categoryStat(key, label, result.alerts),
  );

  const aircraftCounts = new Map<string, number>();
  for (const point of result.trend) {
    for (const item of point.aircraftList) {
      aircraftCounts.set(
        item.aircraft,
        (aircraftCounts.get(item.aircraft) ?? 0) + item.count,
      );
    }
  }

  const callsignCounts = new Map<string, number>();
  for (const detail of allAlertDetails(result.alerts)) {
    if (!detail.callsign) continue;
    callsignCounts.set(
      detail.callsign,
      (callsignCounts.get(detail.callsign) ?? 0) + 1,
    );
  }

  const dominant = maxBy(categories, (c) => c.count);

  return {
    totalMovement: result.movement.totalTakeoff + result.movement.totalLanding,
    peakMovement: maxBy(result.trend, (p) => p.totalMovement),
    peakAlert: maxBy(result.trend, (p) => p.alerts),
    categories,
    alertCritical: categories.reduce((sum, c) => sum + c.critical, 0),
    alertWarning: categories.reduce((sum, c) => sum + c.warning, 0),
    alertInfo: categories.reduce((sum, c) => sum + c.info, 0),
    dominantCategory: dominant,
    topAircraft: rank(aircraftCounts),
    topAlertCallsigns: rank(callsignCounts),
    groundVehicleAvailable:
      result.traffic.totalGroundVehicle > 0 ||
      result.trend.some((p) => p.groundVehicle > 0),
  };
}
