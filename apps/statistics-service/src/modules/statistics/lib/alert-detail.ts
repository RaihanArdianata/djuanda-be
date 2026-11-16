/**
 * Normalisasi baris `alerts` (termasuk kolom JSONB `data`) menjadi detail yang
 * ringkas dan FE-friendly untuk `GET /statistics/operational`.
 *
 * File ini sengaja tidak meng-import database / drizzle supaya bisa diuji murni.
 */

import {
  ALERT_CATEGORY_KEYS,
  ALERT_TYPE_TO_CATEGORY,
  type AlertCategoryKey,
  buildAlertDescription,
  categoryOfAlertType,
  formatAlertDate,
  formatMeters,
  formatNm,
  isRecord,
  parseData,
  parseJson,
  readString,
  toDataView,
} from "@repo/shared/alert-description";

export {
  ALERT_CATEGORY_KEYS,
  ALERT_TYPE_TO_CATEGORY,
  type AlertCategoryKey,
  buildAlertDescription,
  categoryOfAlertType,
  formatAlertDate,
  formatMeters,
  formatNm,
};

export const KNOWN_ALERT_TYPES = Object.keys(ALERT_TYPE_TO_CATEGORY);

import {
  groupIncidents,
  type IncidentAlertInput,
} from "@repo/shared/alert-incident";

/** Satu langkah riwayat verifikasi (dari `alert_actions`, aksi VERIFY), terlama dahulu. */
export interface VerificationEntry {
  /** Waktu langkah (Asia/Jakarta, ISO dengan +07:00). */
  at: string | null;
  by: string | null;
  from: string | null;
  to: string | null;
  note: string | null;
}

export interface AlertVerification {
  /** UNVERIFIED, VERIFIED, atau FALSE_ALARM. */
  status: string;
  by: string | null;
  at: string | null;
  note: string | null;
  history: VerificationEntry[];
}

/** Kejadian tempat sebuah alert bergabung (alert yang sama digabung, lihat `groupIncidents`). */
export interface IncidentRef {
  /** Nomor kejadian pada periode itu, terlama = 1. */
  number: number;
  /** Jumlah alert di dalam kejadian. */
  size: number;
  /** Urutan alert di dalam kejadian, terlama = 1. */
  position: number;
  /** Akhir kejadian (epoch ms), untuk mengurutkan. */
  endAt: number;
}

export interface AlertDetail {
  /** `alerts.alert_id`: dipakai FE untuk membuka alert yang sama di halaman Alert Management. */
  alertId: string | null;
  type: string;
  callsign: string | null;
  severity: string;
  /** Waktu alert dipicu (kolom `triggered_at`, Asia/Jakarta, ISO dengan +07:00). */
  time: string;
  description: string;
  verification: AlertVerification;
  /** Kejadian tempat alert ini bergabung; kosong bila alert tidak punya Alert ID. */
  incident?: IncidentRef | null;
}

/** Baris hasil query detail (kolom `detail_data` sudah berupa JSONB ringkas dari SQL). */
export interface AlertDetailRow {
  alert_id?: string | null;
  airport_id: string;
  type: string;
  severity: string;
  related_track_id: string | null;
  track_id?: string | null;
  /** Berasal dari `alerts.triggered_at` (Asia/Jakarta). */
  time: string;
  detail_data: unknown;
  verification_status?: string | null;
  verified_by?: string | null;
  /** Asia/Jakarta, ISO dengan +07:00. */
  verified_at?: string | null;
  verification_note?: string | null;
  /** Array JSON (atau string JSON) `VerificationEntry`. */
  verification_history?: unknown;
  [column: string]: unknown;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function toEntry(raw: unknown): VerificationEntry | null {
  if (!isRecord(raw)) return null;
  return {
    at: readString(raw, "at"),
    by: readString(raw, "by"),
    from: readString(raw, "from"),
    to: readString(raw, "to"),
    note: readString(raw, "note"),
  };
}

function readHistory(raw: unknown): VerificationEntry[] {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(toEntry).filter((e): e is VerificationEntry => e !== null);
}

export function readVerification(row: AlertDetailRow): AlertVerification {
  const clean = (v: string | null | undefined): string | null =>
    typeof v === "string" && v.trim() !== "" ? v : null;
  return {
    status: clean(row.verification_status) ?? "UNVERIFIED",
    by: clean(row.verified_by),
    at: clean(row.verified_at),
    note: clean(row.verification_note),
    history: readHistory(row.verification_history),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Ubah satu baris DB menjadi detail; mengembalikan null bila type tidak dikenal. */
export function normalizeAlertRow(
  row: AlertDetailRow,
): { category: AlertCategoryKey; detail: AlertDetail } | null {
  const category = categoryOfAlertType(row.type);
  if (!category) return null;

  const view = toDataView(row.detail_data);

  const detail: AlertDetail = {
    alertId:
      typeof row.alert_id === "string" && row.alert_id !== ""
        ? row.alert_id
        : null,
    type: row.type,
    callsign: view.callsign,
    severity: row.severity,
    time: row.time,
    description: buildAlertDescription({
      category,
      dateText: formatAlertDate(row.time),
      callsign: view.callsign,
      airportId: row.airport_id,
      severity: row.severity,
      relatedTrackId: row.related_track_id ?? null,
      area: view.area,
      surface: view.surface,
      facts: view.facts,
    }),
    verification: readVerification(row),
  };
  return { category, detail };
}

export type AlertDetailsByCategory = Record<AlertCategoryKey, AlertDetail[]>;

function groupDetailsWithRefs(
  rows: AlertDetailRow[],
  refs: Map<string, IncidentRef>,
): AlertDetailsByCategory {
  const grouped: AlertDetailsByCategory = {
    stca: [],
    apa: [],
    da: [],
    ria: [],
    taia: [],
  };
  for (const row of rows) {
    const normalized = normalizeAlertRow(row);
    if (!normalized) continue;
    const { detail } = normalized;
    if (detail.alertId) detail.incident = refs.get(detail.alertId) ?? null;
    grouped[normalized.category].push(detail);
  }
  return grouped;
}

export function groupAlertDetails(
  rows: AlertDetailRow[],
): AlertDetailsByCategory {
  return groupDetailsWithRefs(rows, incidentRefs(rows));
}

// ---------------------------------------------------------------------------
// Kejadian (incident): alert yang sama digabung, supaya hitungan tidak membengkak oleh pemicuan ulang
// ---------------------------------------------------------------------------

export interface AlertIncidentSummary {
  /** Jumlah kejadian setelah alert yang sama digabung (callsign lintas jenis, rantai 15 menit, STCA per pasangan). */
  total: number;
  /** Kejadian yang memuat jenis itu; kejadian lintas jenis dihitung sekali di tiap jenisnya. */
  byCategory: Record<AlertCategoryKey, number>;
  /** Kejadian yang masih punya alert belum dinilai. */
  needsAction: number;
}

export const NO_INCIDENTS: AlertIncidentSummary = {
  total: 0,
  byCategory: { stca: 0, apa: 0, da: 0, ria: 0, taia: 0 },
  needsAction: 0,
};

function toIncidentInput(row: AlertDetailRow): IncidentAlertInput | null {
  const category = categoryOfAlertType(row.type);
  const at = Date.parse(row.time);
  if (!category || Number.isNaN(at)) return null;
  const view = toDataView(row.detail_data);
  const data = parseData(row.detail_data);
  return {
    alertId:
      typeof row.alert_id === "string" && row.alert_id !== ""
        ? row.alert_id
        : `${row.type}|${row.time}|${view.callsign ?? ""}`,
    type: row.type,
    severity: row.severity,
    status: "CLEARED",
    triggeredAt: at,
    callsign: view.callsign,
    relatedCallsign: readString(data, "relatedCallsign"),
    trackId:
      typeof row.track_id === "string"
        ? row.track_id
        : (row.related_track_id ?? ""),
    verificationStatus: row.verification_status ?? "UNVERIFIED",
  };
}

type GroupedIncidents = ReturnType<typeof groupIncidents>;

function toIncidentInputs(rows: AlertDetailRow[]): IncidentAlertInput[] {
  return rows
    .map(toIncidentInput)
    .filter((r): r is IncidentAlertInput => r !== null);
}

function refsFromIncidents(
  incidents: GroupedIncidents,
): Map<string, IncidentRef> {
  const sorted = [...incidents].sort(
    (a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id),
  );
  const refs = new Map<string, IncidentRef>();
  sorted.forEach((incident, index) => {
    incident.alertIds.forEach((alertId, position) => {
      refs.set(alertId, {
        number: index + 1,
        size: incident.count,
        position: position + 1,
        endAt: incident.endAt,
      });
    });
  });
  return refs;
}

function summaryFromIncidents(
  incidents: GroupedIncidents,
): AlertIncidentSummary {
  const byCategory: Record<AlertCategoryKey, number> = {
    stca: 0,
    apa: 0,
    da: 0,
    ria: 0,
    taia: 0,
  };
  for (const incident of incidents) {
    const seen = new Set<AlertCategoryKey>();
    for (const type of Object.keys(incident.typeCounts)) {
      const category = categoryOfAlertType(type);
      if (category) seen.add(category);
    }
    for (const category of seen) byCategory[category]++;
  }
  return {
    total: incidents.length,
    byCategory,
    needsAction: incidents.filter((i) => i.needsAction).length,
  };
}

export function incidentRefs(rows: AlertDetailRow[]): Map<string, IncidentRef> {
  return refsFromIncidents(groupIncidents(toIncidentInputs(rows)));
}

export function summarizeIncidents(
  rows: AlertDetailRow[],
): AlertIncidentSummary {
  return summaryFromIncidents(groupIncidents(toIncidentInputs(rows)));
}
export function analyzeAlertRows(rows: AlertDetailRow[]): {
  details: AlertDetailsByCategory;
  incidents: AlertIncidentSummary;
} {
  const grouped = groupIncidents(toIncidentInputs(rows));
  return {
    details: groupDetailsWithRefs(rows, refsFromIncidents(grouped)),
    incidents: summaryFromIncidents(grouped),
  };
}
