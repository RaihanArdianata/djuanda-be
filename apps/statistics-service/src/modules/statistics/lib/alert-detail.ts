/**
 * Normalisasi baris `alerts` (termasuk kolom JSONB `data`) menjadi detail yang
 * ringkas dan FE-friendly untuk `GET /statistics/operational`.
 *
 * File ini sengaja tidak meng-import database / drizzle supaya bisa diuji murni.
 */

export const ALERT_CATEGORY_KEYS = [
  "stca",
  "apa",
  "da",
  "ria",
  "taia",
] as const;
export type AlertCategoryKey = (typeof ALERT_CATEGORY_KEYS)[number];

/** Mapping `alerts.type` -> key response. Sama dengan yang dipakai `typeFilter` di service. */
export const ALERT_TYPE_TO_CATEGORY: Readonly<
  Record<string, AlertCategoryKey>
> = {
  STCA: "stca",
  AREA_PENETRATION: "apa",
  DEVIATION: "da",
  RUNWAY_INCURSION: "ria",
  TAXIWAY_APRON_INCURSION: "taia",
};

export const KNOWN_ALERT_TYPES = Object.keys(ALERT_TYPE_TO_CATEGORY);

export interface AlertDetail {
  type: string;
  callsign: string | null;
  severity: string;
  /** Waktu alert dipicu (kolom `triggered_at`, Asia/Jakarta, ISO dengan +07:00). */
  time: string;
  description: string;
}

/** Baris hasil query detail (kolom `detail_data` sudah berupa JSONB ringkas dari SQL). */
export interface AlertDetailRow {
  airport_id: string;
  type: string;
  severity: string;
  related_track_id: string | null;
  /** Berasal dari `alerts.triggered_at` (Asia/Jakarta). */
  time: string;
  detail_data: unknown;
  [column: string]: unknown;
}

// ---------------------------------------------------------------------------
// Type guards & readers untuk `alerts.data` (unknown -> typed view)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: JsonRecord | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readRecord(source: JsonRecord | null, key: string): JsonRecord | null {
  const value = source?.[key];
  return isRecord(value) ? value : null;
}

function parseData(raw: unknown): JsonRecord | null {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(raw) ? raw : null;
}

interface ZoneView {
  name: string | null;
  type: string | null;
  status: string | null;
}

interface AlertDataView {
  callsign: string | null;
  area: ZoneView | null;
  surface: ZoneView | null;
}

/**
 * `area` dipakai AREA_PENETRATION, `surface` dipakai TAXIWAY_APRON_INCURSION.
 * Field top-level (`areaName`, `surfaceType`, ...) dipakai sebagai fallback.
 * Nama yang sama dengan id (mis. surface tanpa nama) dianggap tidak ada.
 */
function readZone(
  data: JsonRecord,
  zoneKey: "area" | "surface",
): ZoneView | null {
  const zone = readRecord(data, zoneKey);
  const id = readString(zone, "id") ?? readString(data, `${zoneKey}Id`);
  const name = readString(zone, "name") ?? readString(data, `${zoneKey}Name`);
  const type = readString(zone, "type") ?? readString(data, `${zoneKey}Type`);
  const status =
    readString(zone, "status") ?? readString(data, `${zoneKey}Status`);

  if (!(zone || name || type || status)) return null;
  return {
    name: name !== null && name === id ? null : name,
    type,
    status,
  };
}

function toDataView(raw: unknown): AlertDataView {
  const data = parseData(raw);
  if (!data) return { callsign: null, area: null, surface: null };
  const track = readRecord(data, "track");
  return {
    callsign: readString(track, "callsign") ?? readString(data, "callsign"),
    area: readZone(data, "area"),
    surface: readZone(data, "surface"),
  };
}

// ---------------------------------------------------------------------------
// Description generator
// ---------------------------------------------------------------------------

function aircraftSubject(callsign: string | null): string {
  return callsign
    ? `aircraft callsign ${callsign}`
    : "aircraft (callsign tidak diketahui)";
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const MONTHS_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

/** "2026-09-20T14:40:06+07:00" -> "20 September 2026 pukul 14:40:06 WIB" (waktu lokal Jakarta, tanpa konversi zona). */
export function formatAlertDate(time: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}:\d{2}))?/.exec(time);
  if (!match) return null;
  const month = MONTHS_ID[Number(match[2]) - 1];
  if (!month) return null;
  const clock = match[4] ? ` pukul ${match[4]} WIB` : "";
  return `${Number(match[3])} ${month} ${match[1]}${clock}`;
}

function onDate(dateText: string | null): string {
  return dateText ? ` pada tanggal ${dateText}` : "";
}

interface DescriptionInput {
  category: AlertCategoryKey;
  dateText: string | null;
  callsign: string | null;
  airportId: string;
  severity: string;
  relatedTrackId: string | null;
  area: ZoneView | null;
  surface: ZoneView | null;
}

function describeAreaPenetration(input: DescriptionInput): string {
  const { area } = input;
  const isRestricted = area?.status?.toUpperCase() === "RESTRICTED";
  const areaLabel = [isRestricted ? "restricted area" : "area", area?.name]
    .filter(Boolean)
    .join(" ");
  const areaType = area?.type ? ` yang bertipe ${area.type}` : "";
  return `${capitalize(aircraftSubject(input.callsign))} memasuki ${areaLabel}${areaType} di airport ${input.airportId}${onDate(input.dateText)} dengan severity ${input.severity}.`;
}

function describeTaxiwayApronIncursion(input: DescriptionInput): string {
  const surfaceType = input.surface?.type ? ` pada ${input.surface.type}` : "";
  return `Telah terjadi Taxiway/Apron Incursion yang melibatkan ${aircraftSubject(input.callsign)}${surfaceType} di airport ${input.airportId}${onDate(input.dateText)}.`;
}

function describeStca(input: DescriptionInput): string {
  const related = input.relatedTrackId
    ? ` dan related track ${input.relatedTrackId}`
    : "";
  return `Telah terjadi Short Term Conflict Alert (STCA) yang melibatkan ${aircraftSubject(input.callsign)}${related} di airport ${input.airportId}${onDate(input.dateText)}.`;
}

function describeGeneric(label: string, input: DescriptionInput): string {
  const zone = input.surface ?? input.area;
  const zoneText = zone?.type ? ` pada ${zone.type}` : "";
  return `Telah terjadi ${label} yang melibatkan ${aircraftSubject(input.callsign)}${zoneText} di airport ${input.airportId}${onDate(input.dateText)}.`;
}

export function buildAlertDescription(input: DescriptionInput): string {
  switch (input.category) {
    case "apa":
      return describeAreaPenetration(input);
    case "taia":
      return describeTaxiwayApronIncursion(input);
    case "stca":
      return describeStca(input);
    case "ria":
      return describeGeneric("Runway Incursion (RIA)", input);
    case "da":
      return describeGeneric("Deviation Alert (DA)", input);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function categoryOfAlertType(type: string): AlertCategoryKey | null {
  return ALERT_TYPE_TO_CATEGORY[type.toUpperCase()] ?? null;
}

/** Ubah satu baris DB menjadi detail; mengembalikan null bila type tidak dikenal. */
export function normalizeAlertRow(
  row: AlertDetailRow,
): { category: AlertCategoryKey; detail: AlertDetail } | null {
  const category = categoryOfAlertType(row.type);
  if (!category) return null;

  const view = toDataView(row.detail_data);

  const detail: AlertDetail = {
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
    }),
  };
  return { category, detail };
}

export type AlertDetailsByCategory = Record<AlertCategoryKey, AlertDetail[]>;

export function groupAlertDetails(
  rows: AlertDetailRow[],
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
    if (normalized) grouped[normalized.category].push(normalized.detail);
  }
  return grouped;
}
