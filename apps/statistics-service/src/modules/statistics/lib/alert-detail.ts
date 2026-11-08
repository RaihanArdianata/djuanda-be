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

function readNumber(source: JsonRecord | null, key: string): number | null {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(source: JsonRecord | null, key: string): boolean | null {
  const value = source?.[key];
  return typeof value === "boolean" ? value : null;
}

function readRecord(source: JsonRecord | null, key: string): JsonRecord | null {
  const value = source?.[key];
  return isRecord(value) ? value : null;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseData(raw: unknown): JsonRecord | null {
  const parsed = parseJson(raw);
  return isRecord(parsed) ? parsed : null;
}

interface ZoneView {
  name: string | null;
  type: string | null;
  status: string | null;
}

/** Angka dan teks tambahan di `alerts.data` yang dipakai untuk menjelaskan sebab dan jarak. */
interface AlertFacts {
  domain: string | null;
  relatedCallsign: string | null;
  reason: string | null;
  runwayName: string | null;
  runwayStatus: string | null;
  // STCA
  predictedTimeSeconds: number | null;
  horizontalSeparationNm: number | null;
  minimumHorizontalSeparationNm: number | null;
  horizontalSeparationMeters: number | null;
  minimumSeparationMeters: number | null;
  predictedVerticalSeparationFt: number | null;
  minimumVerticalSeparationFt: number | null;
  // Taxiway/apron dan deviasi
  distanceMeters: number | null;
  maxDistanceMeters: number | null;
  criticalMeters: number | null;
  horizontalDistanceMeters: number | null;
  altitudeDeviationFt: number | null;
  maxAltitudeDeviationFt: number | null;
  timeDeviationSeconds: number | null;
  timeExceeded: boolean | null;
}

interface AlertDataView {
  callsign: string | null;
  area: ZoneView | null;
  surface: ZoneView | null;
  facts: AlertFacts;
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

function readFacts(data: JsonRecord): AlertFacts {
  const num = (key: string): number | null => readNumber(data, key);
  return {
    domain: readString(data, "domain"),
    relatedCallsign: readString(data, "relatedCallsign"),
    reason: readString(data, "reason"),
    runwayName: readString(data, "runwayName"),
    runwayStatus: readString(data, "runwayStatus"),
    predictedTimeSeconds: num("predictedTimeSeconds"),
    horizontalSeparationNm: num("horizontalSeparationNm"),
    minimumHorizontalSeparationNm: num("minimumHorizontalSeparationNm"),
    horizontalSeparationMeters: num("horizontalSeparationMeters"),
    minimumSeparationMeters: num("minimumSeparationMeters"),
    predictedVerticalSeparationFt: num("predictedVerticalSeparationFt"),
    minimumVerticalSeparationFt: num("minimumVerticalSeparationFt"),
    distanceMeters: num("distanceMeters"),
    maxDistanceMeters: num("maxDistanceMeters"),
    criticalMeters: num("criticalMeters"),
    horizontalDistanceMeters: num("horizontalDistanceMeters"),
    altitudeDeviationFt: num("altitudeDeviationFt"),
    maxAltitudeDeviationFt: num("maxAltitudeDeviationFt"),
    timeDeviationSeconds: num("timeDeviationSeconds"),
    timeExceeded: readBoolean(data, "timeExceeded"),
  };
}

const NO_FACTS: AlertFacts = readFacts({});

function toDataView(raw: unknown): AlertDataView {
  const data = parseData(raw);
  if (!data)
    return { callsign: null, area: null, surface: null, facts: NO_FACTS };
  const track = readRecord(data, "track");
  return {
    callsign: readString(track, "callsign") ?? readString(data, "callsign"),
    area: readZone(data, "area"),
    surface: readZone(data, "surface"),
    facts: readFacts(data),
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

const NUMBER_FORMAT = new Intl.NumberFormat("id-ID", {
  maximumFractionDigits: 1,
});

/** `120 m` atau `1,3 km`; meter dibulatkan, jarak jauh dalam kilometer. */
export function formatMeters(meters: number): string {
  return meters >= 1000
    ? `${NUMBER_FORMAT.format(meters / 1000)} km`
    : `${Math.round(meters)} m`;
}

export function formatNm(nm: number): string {
  return `${NUMBER_FORMAT.format(nm)} NM`;
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
  facts?: AlertFacts;
}

/** Penutup yang sama untuk semua alert: lokasi bandara, kapan, dan tingkat keparahan. */
function tail(input: DescriptionInput): string {
  return ` di airport ${input.airportId}${onDate(input.dateText)} dengan severity ${input.severity}.`;
}

function zoneLabel(zone: ZoneView | null, fallback: string): string {
  const parts = [zone?.type, zone?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : fallback;
}

/** Jarak dan batas pemisahan menurut satuannya: meter untuk STCA darat, NM untuk STCA udara. */
function stcaFigures(f: AlertFacts): {
  distance: string | null;
  limit: string | null;
} {
  if (f.domain === "SURFACE") {
    return {
      distance: orNull(f.horizontalSeparationMeters, formatMeters),
      limit: orNull(f.minimumSeparationMeters, formatMeters),
    };
  }
  return {
    distance: orNull(f.horizontalSeparationNm, formatNm),
    limit: orNull(f.minimumHorizontalSeparationNm, formatNm),
  };
}

function orNull(
  value: number | null,
  format: (v: number) => string,
): string | null {
  return value === null ? null : format(value);
}

function stcaVertical(f: AlertFacts): string {
  if (f.predictedVerticalSeparationFt === null || f.domain === "SURFACE")
    return "";
  const limit =
    f.minimumVerticalSeparationFt !== null
      ? ` (batas ${Math.round(f.minimumVerticalSeparationFt)} ft)`
      : "";
  return `, selisih ketinggian ${Math.round(f.predictedVerticalSeparationFt)} ft${limit}`;
}

function stcaGap(f: AlertFacts): string {
  const { distance, limit } = stcaFigures(f);
  if (distance === null) return "";
  const inTime =
    f.predictedTimeSeconds !== null
      ? ` dalam ${Math.round(f.predictedTimeSeconds)} detik`
      : "";
  const below = limit ? `, di bawah batas pemisahan ${limit}` : "";
  return `diprediksi berada pada jarak ${distance}${inTime}${below}${stcaVertical(f)}`;
}

function describeStca(input: DescriptionInput): string {
  const f = input.facts ?? NO_FACTS;
  const kind = f.domain === "SURFACE" ? "STCA darat" : "STCA udara";
  const other = f.relatedCallsign
    ? ` dan aircraft callsign ${f.relatedCallsign}`
    : input.relatedTrackId
      ? ` dan related track ${input.relatedTrackId}`
      : "";
  const gap = stcaGap(f);
  const why = gap
    ? `: ${aircraftSubject(input.callsign)}${other} ${gap}`
    : ` yang melibatkan ${aircraftSubject(input.callsign)}${other}`;
  return `Potensi Short Term Conflict Alert (${kind})${why}${tail(input)}`;
}

function describeAreaPenetration(input: DescriptionInput): string {
  const { area } = input;
  const isRestricted = area?.status?.toUpperCase() === "RESTRICTED";
  const areaLabel = [isRestricted ? "restricted area" : "area", area?.name]
    .filter(Boolean)
    .join(" ");
  const areaType = area?.type ? ` yang bertipe ${area.type}` : "";
  const why = isRestricted
    ? ", yaitu area yang sedang dibatasi sehingga target yang masuk dianggap pelanggaran"
    : "";
  return `Potensi pelanggaran area: ${aircraftSubject(input.callsign)} memasuki ${areaLabel}${areaType}${why}${tail(input)}`;
}

function describeTaxiwayApronIncursion(input: DescriptionInput): string {
  const f = input.facts ?? NO_FACTS;
  const where = input.surface
    ? ` pada ${zoneLabel(input.surface, "taxiway/apron")}`
    : "";
  const head = `Potensi Taxiway/Apron Incursion: ${aircraftSubject(input.callsign)}`;

  if (f.relatedCallsign) {
    const gap =
      f.distanceMeters !== null
        ? `, berjarak ${formatMeters(f.distanceMeters)}${
            f.criticalMeters !== null
              ? ` (batas kritis ${formatMeters(f.criticalMeters)})`
              : ""
          }`
        : "";
    return `${head} memasuki permukaan${where} yang sedang dipakai aircraft callsign ${f.relatedCallsign}${gap}${tail(input)}`;
  }
  if (f.reason === "OFF_ROUTE" && f.distanceMeters !== null) {
    const limit =
      f.maxDistanceMeters !== null
        ? ` (batas ${formatMeters(f.maxDistanceMeters)})`
        : "";
    return `${head} menyimpang ${formatMeters(f.distanceMeters)} dari rute taxiway${limit}${where}${tail(input)}`;
  }
  return `${head} berada di luar jalur yang diizinkan${where}${tail(input)}`;
}

function describeRunwayIncursion(input: DescriptionInput): string {
  const f = input.facts ?? NO_FACTS;
  const runway = f.runwayName ? `runway ${f.runwayName}` : "runway";
  const occupant = f.relatedCallsign
    ? ` yang sedang dipakai aircraft callsign ${f.relatedCallsign}`
    : "";
  const status = f.runwayStatus ? ` (status ${f.runwayStatus})` : "";
  return `Potensi Runway Incursion (RIA): ${aircraftSubject(input.callsign)} memasuki ${runway}${occupant}${status}${tail(input)}`;
}

function describeDeviation(input: DescriptionInput): string {
  const f = input.facts ?? NO_FACTS;
  const parts: string[] = [];
  if (f.horizontalDistanceMeters !== null) {
    const limit =
      f.maxDistanceMeters !== null
        ? ` (batas ${formatMeters(f.maxDistanceMeters)})`
        : "";
    parts.push(
      `menyimpang ${formatMeters(f.horizontalDistanceMeters)} dari rute${limit}`,
    );
  }
  if (f.altitudeDeviationFt !== null) {
    const limit =
      f.maxAltitudeDeviationFt !== null
        ? ` (batas ${Math.round(f.maxAltitudeDeviationFt)} ft)`
        : "";
    parts.push(
      `mengalami selisih ketinggian ${Math.round(Math.abs(f.altitudeDeviationFt))} ft${limit}`,
    );
  }
  if (f.timeDeviationSeconds !== null && f.timeExceeded) {
    parts.push(
      `mengalami selisih waktu ${Math.round(Math.abs(f.timeDeviationSeconds))} detik dari jadwal`,
    );
  }
  const detail =
    parts.length > 0
      ? parts.join(", ")
      : "menyimpang dari rute yang direncanakan";
  return `Potensi Deviation Alert (DA): ${aircraftSubject(input.callsign)} ${detail}${tail(input)}`;
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
      return describeRunwayIncursion(input);
    case "da":
      return describeDeviation(input);
  }
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

export function summarizeIncidents(
  rows: AlertDetailRow[],
): AlertIncidentSummary {
  const inputs = rows
    .map(toIncidentInput)
    .filter((r): r is IncidentAlertInput => r !== null);
  const incidents = groupIncidents(inputs);
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
    needsAction: incidents.filter((i) => i.verificationCounts.unverified > 0)
      .length,
  };
}
