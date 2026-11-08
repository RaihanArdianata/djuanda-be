import {
  type Incident,
  type IncidentVerification,
  severityRank,
} from "@repo/shared/alert-incident";

/** Alasan baku untuk Alarm palsu, supaya penyebab positif palsu bisa dihitung dan dipakai menyetel aturan. */
export const FALSE_ALARM_REASONS = {
  SCHEDULED_MOVEMENT: "Pergerakan terjadwal",
  RADAR_NOISE: "Derau radar",
  WRONG_POSITION: "Posisi data salah",
  AUTHORIZED_VEHICLE: "Kendaraan berizin",
  OTHER: "Lainnya",
} as const;

export type FalseAlarmReason = keyof typeof FALSE_ALARM_REASONS;

export const FALSE_ALARM_REASON_CODES = Object.keys(FALSE_ALARM_REASONS) as [
  FalseAlarmReason,
  ...FalseAlarmReason[],
];

/** Catatan yang disimpan di alert: alasan baku di depan, lalu catatan bebas. */
export function composeVerificationNote(
  reason: FalseAlarmReason | undefined,
  note: string | undefined,
): string | undefined {
  const text = note?.trim() ?? "";
  const label = reason ? FALSE_ALARM_REASONS[reason] : undefined;
  if (label && text) return `${label}: ${text}`;
  return label ?? (text || undefined);
}

export interface IncidentFilter {
  /** Jenis alert (`RUNWAY_INCURSION`): kejadian yang memuat jenis ini. */
  type?: string;
  /** Severity kejadian (tertinggi di antara anggota), dipisah koma. */
  severity?: string;
  /** `ACTIVE` bila masih ada alert aktif, `CLEARED` bila semuanya sudah selesai. */
  status?: string;
  /** Hasil rangkuman verifikasi kejadian; `NEEDS_ACTION` = masih ada alert yang belum dinilai. */
  verification?: IncidentVerification | "NEEDS_ACTION";
  /** Kata kunci bebas: callsign, pesawat terkait, jenis, Alert ID. Tiap kata harus cocok. */
  q?: string;
}

const norm = (v: string): string => v.trim().toUpperCase();

function matchesQuery(incident: Incident, q: string): boolean {
  const tokens = q.split(/\s+/).map(norm).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = [
    incident.callsign ?? "",
    ...(incident.pair ?? []),
    ...incident.relatedCallsigns,
    ...Object.keys(incident.typeCounts),
    ...incident.alertIds,
  ]
    .join(" ")
    .toUpperCase();
  return tokens.every((t) => haystack.includes(t));
}

function hasType(incident: Incident, type: string): boolean {
  const wanted = norm(type);
  return Object.keys(incident.typeCounts).some(
    (k) => k.toUpperCase() === wanted,
  );
}

function matchesVerification(
  incident: Incident,
  wanted: IncidentFilter["verification"],
): boolean {
  if (!wanted) return true;
  if (wanted === "NEEDS_ACTION")
    return incident.verificationCounts.unverified > 0;
  return incident.verification === wanted;
}

function matchesStatus(
  incident: Incident,
  status: string | undefined,
): boolean {
  if (status === "ACTIVE") return incident.hasActive;
  if (status === "CLEARED") return !incident.hasActive;
  return true;
}

export function filterIncidents(
  incidents: readonly Incident[],
  filter: IncidentFilter,
): Incident[] {
  const severities = filter.severity?.split(",").map(norm).filter(Boolean);
  return incidents.filter(
    (i) =>
      (!filter.type || hasType(i, filter.type)) &&
      (!severities?.length || severities.includes(norm(i.severity))) &&
      matchesStatus(i, filter.status) &&
      matchesVerification(i, filter.verification) &&
      (!filter.q || matchesQuery(i, filter.q)),
  );
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  limit: number,
): T[] {
  const start = (page - 1) * limit;
  return items.slice(start, start + limit);
}

/** Verifikasi Critical harus dikonfirmasi eksplisit: "verifikasi semua" tidak boleh jadi kebiasaan buta. */
export function needsCriticalConfirmation(
  severities: readonly string[],
): boolean {
  return severities.some((s) => severityRank(s) >= severityRank("CRITICAL"));
}
