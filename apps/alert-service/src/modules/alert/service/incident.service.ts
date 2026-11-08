import {
  groupIncidents,
  type Incident,
  incidentCountByType,
} from "@repo/shared/alert-incident";
import { filterIncidents, paginate } from "../incident/incident-query";
import { listIncidentSources } from "../repository/alert.repository";
import type { ListIncidentsInput } from "../validator/alert.validator";

const DAY_MS = 86_400_000;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 120;
const CACHE_MS = 20_000;

const cache = new Map<string, { at: number; incidents: Incident[] }>();

/** Rentang bawaan 30 hari terakhir; paling lebar 120 hari supaya satu permintaan tidak menarik seluruh tabel. */
export function resolveRange(
  startDate: Date | undefined,
  endDate: Date | undefined,
  now: number = Date.now(),
): { start: Date; end: Date } {
  const end = endDate ?? new Date(now);
  const earliest = end.getTime() - MAX_RANGE_DAYS * DAY_MS;
  const wanted =
    startDate?.getTime() ?? end.getTime() - DEFAULT_RANGE_DAYS * DAY_MS;
  return { start: new Date(Math.max(wanted, earliest)), end };
}

async function loadIncidents(
  airportId: string | undefined,
  start: Date,
  end: Date,
): Promise<Incident[]> {
  // Dibulatkan ke menit supaya permintaan beruntun memakai hasil yang sama selama beberapa detik.
  const key = `${airportId ?? "*"}|${Math.floor(start.getTime() / 60_000)}|${Math.floor(end.getTime() / 60_000)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.incidents;

  const sources = await listIncidentSources({
    airportId,
    startDate: start,
    endDate: end,
  });
  const incidents = groupIncidents(sources);
  cache.set(key, { at: Date.now(), incidents });
  if (cache.size > 20) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return incidents;
}

export function forgetIncidentCache(): void {
  cache.clear();
}

export interface IncidentListResult {
  items: Incident[];
  total: number;
  summary: {
    incidents: number;
    alerts: number;
    byType: Record<string, number>;
    needsAction: number;
  };
}

export async function listIncidentsService(
  input: ListIncidentsInput,
): Promise<IncidentListResult> {
  const { start, end } = resolveRange(input.startDate, input.endDate);
  const all = await loadIncidents(input.airportId, start, end);
  const matched = filterIncidents(all, input);

  return {
    items: paginate(matched, input.page, input.limit),
    total: matched.length,
    summary: {
      incidents: matched.length,
      alerts: matched.reduce((sum, i) => sum + i.count, 0),
      byType: incidentCountByType(matched),
      needsAction: matched.filter((i) => i.verificationCounts.unverified > 0)
        .length,
    },
  };
}
