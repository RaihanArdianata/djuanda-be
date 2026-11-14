/**
 * Kalimat keterangan sebuah alert (Potensi ..., jarak, batas, sebab, waktu), dibuat dari baris `alerts` dan kolom JSONB `data`-nya.
 * Dipakai bersama oleh layanan statistik (ekspor Excel, daftar di Statistik) dan layanan alert (dialog verifikasi), supaya kalimatnya sama.
 *
 * Murni (tanpa database) supaya bisa diuji.
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

export function categoryOfAlertType(type: string): AlertCategoryKey | null {
  return ALERT_TYPE_TO_CATEGORY[type.toUpperCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Type guards & readers untuk `alerts.data` (unknown -> typed view)
// ---------------------------------------------------------------------------

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readString(
  source: JsonRecord | null,
  key: string,
): string | null {
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

export function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function parseData(raw: unknown): JsonRecord | null {
  const parsed = parseJson(raw);
  return isRecord(parsed) ? parsed : null;
}

export interface ZoneView {
  name: string | null;
  type: string | null;
  status: string | null;
}

/** Angka dan teks tambahan di `alerts.data` yang dipakai untuk menjelaskan sebab dan jarak. */
export interface AlertFacts {
  domain: string | null;
  /** Sub-kategori STCA: AIR_HIGH | AIR_MID | AIR_CLOSE | AIR_LOW_CROSSING | AIR_LOW_DOME | SURFACE. */
  category: string | null;
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

export interface AlertDataView {
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
    category: readString(data, "category"),
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

export function toDataView(raw: unknown): AlertDataView {
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

export interface DescriptionInput {
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

function stcaUsesMeters(f: AlertFacts): boolean {
  return (
    f.domain === "SURFACE" ||
    f.category === "AIR_MID" ||
    f.category === "AIR_CLOSE" ||
    f.category === "AIR_LOW_CROSSING" ||
    f.category === "AIR_LOW_DOME"
  );
}

/** Jarak dan batas pemisahan menurut satuannya: meter untuk darat dan udara rendah, NM untuk AIR_HIGH. */
function stcaFigures(f: AlertFacts): {
  distance: string | null;
  limit: string | null;
} {
  if (stcaUsesMeters(f)) {
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
  const current = f.category === "AIR_LOW_DOME" || f.category === "AIR_CLOSE";
  const inTime =
    !current && f.predictedTimeSeconds !== null
      ? ` dalam ${Math.round(f.predictedTimeSeconds)} detik`
      : "";
  const below = limit ? `, di bawah batas pemisahan ${limit}` : "";
  const verb = current ? "berada pada jarak" : "diprediksi berada pada jarak";
  return `${verb} ${distance}${inTime}${below}${stcaVertical(f)}`;
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
  return `Potensi Runway Incursion: ${aircraftSubject(input.callsign)} memasuki ${runway}${occupant}${status}${tail(input)}`;
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
  return `Potensi Deviation Alert: ${aircraftSubject(input.callsign)} ${detail}${tail(input)}`;
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
