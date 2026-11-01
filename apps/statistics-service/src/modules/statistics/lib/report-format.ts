/**
 * Format teks untuk laporan Excel: tanggal Indonesia, label periode, dan kategori alert.
 * Murni (tanpa database/ExcelJS) supaya mudah diuji.
 */

const MONTHS_LONG = [
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

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
] as const;

export type ReportPeriod = "hourly" | "daily" | "weekly" | "monthly";

export const PERIOD_LABEL: Readonly<Record<ReportPeriod, string>> = {
  hourly: "Per Jam",
  daily: "Harian",
  weekly: "Mingguan",
  monthly: "Bulanan",
};

/** Satuan periode untuk judul: "AKTIVITAS PESAWAT PER JAM". */
export const PERIOD_UNIT: Readonly<Record<ReportPeriod, string>> = {
  hourly: "JAM",
  daily: "HARI",
  weekly: "MINGGU",
  monthly: "BULAN",
};

/** Kolom pertama tabel tren menurut periode. */
export const PERIOD_COLUMN_LABEL: Readonly<Record<ReportPeriod, string>> = {
  hourly: "Jam",
  daily: "Tanggal",
  weekly: "Minggu (mulai)",
  monthly: "Bulan",
};

interface DateParts {
  year: number;
  month: number;
  day: number;
}

/** "YYYY-MM-DD" (atau awalan "YYYY-MM-DDT...") menjadi bagian-bagiannya; null bila tidak valid. */
export function parseDateOnly(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month, day: Number(match[3]) };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "2026-11-02" -> "02 November 2026". Nilai tak valid dikembalikan apa adanya. */
export function formatDateLong(value: string): string {
  const p = parseDateOnly(value);
  if (!p) return value;
  return `${pad2(p.day)} ${MONTHS_LONG[p.month - 1]} ${p.year}`;
}

/** "2026-11-02" -> "02 Nov 2026". */
export function formatDateShort(value: string): string {
  const p = parseDateOnly(value);
  if (!p) return value;
  return `${pad2(p.day)} ${MONTHS_SHORT[p.month - 1]} ${p.year}`;
}

/** "2026-11-02T09:00" -> "02 Nov 2026 09:00". */
export function formatHourBucket(value: string): string {
  const date = formatDateShort(value);
  const time = /T(\d{2}:\d{2})/.exec(value)?.[1];
  return time ? `${date} ${time}` : date;
}

/** Rentang "2026-10-26 - 2026-11-01" menjadi "26 Okt 2026 – 01 Nov 2026". */
export function formatRange(range: string): string {
  const [start, end] = range.split(" - ");
  if (!(start && end)) return range;
  return `${formatDateShort(start)} – ${formatDateShort(end)}`;
}

export interface TrendLabelInput {
  period: string;
  periodRange?: string;
}

/** Label baris tren sesuai jenis periode. */
export function trendLabel(
  period: ReportPeriod,
  point: TrendLabelInput,
): string {
  switch (period) {
    case "hourly":
      return formatHourBucket(point.period);
    case "daily":
      return formatDateShort(point.period);
    case "weekly":
      return point.periodRange
        ? formatRange(point.periodRange)
        : formatDateShort(point.period);
    case "monthly": {
      const p = parseDateOnly(point.period);
      return p ? `${MONTHS_LONG[p.month - 1]} ${p.year}` : point.period;
    }
    default:
      return point.period;
  }
}

/** Rentang yang tampil di kolom "Rentang" (kosong bila periodenya sendiri sudah jelas). */
export function trendRangeLabel(
  period: ReportPeriod,
  point: TrendLabelInput,
): string {
  if (period === "monthly" && point.periodRange)
    return formatRange(point.periodRange);
  return "";
}

/** Waktu cetak dalam WIB: "02 November 2026, 14:05 WIB". */
export function formatGeneratedAt(date: Date): string {
  const wib = new Date(date.getTime() + 7 * 3_600_000);
  const iso = wib.toISOString();
  return `${formatDateLong(iso.slice(0, 10))}, ${iso.slice(11, 16)} WIB`;
}

/**
 * Waktu "2026-11-02T09:15:00+07:00" (sudah WIB) menjadi Date yang bagian UTC-nya berisi jam WIB.
 * Excel tidak menyimpan zona waktu, jadi jam dinding WIB ditulis apa adanya dan kolomnya diberi
 * judul "(WIB)". Null bila tidak valid.
 */
export function wallClockDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(
    value,
  );
  if (!match) return null;
  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] ?? 0),
    ),
  );
}

export type AlertCategoryKey = "ria" | "stca" | "da" | "apa" | "taia";

/** Urutan dan nama kategori alert di laporan (urutan sama dengan dashboard). */
export const ALERT_CATEGORIES: ReadonlyArray<{
  key: AlertCategoryKey;
  label: string;
}> = [
  { key: "ria", label: "Runway Incursion" },
  { key: "stca", label: "Short Term Conflict (STCA)" },
  { key: "da", label: "Deviation" },
  { key: "apa", label: "Area Penetration" },
  { key: "taia", label: "Taxiway / Apron Incursion" },
];

export const SEVERITY_LABEL: Readonly<Record<string, string>> = {
  CRITICAL: "Critical",
  WARNING: "Warning",
};

/** Nama bandara untuk judul; kode lain tampil sebagai kodenya saja. */
const AIRPORT_NAMES: Readonly<Record<string, string>> = {
  WARR: "Juanda International Airport",
};

export function airportTitle(airportId: string): string {
  const name = AIRPORT_NAMES[airportId.toUpperCase()];
  return name ? `${name} (${airportId.toUpperCase()})` : airportId;
}

export function reportFilename(
  period: ReportPeriod,
  startDate: string,
  endDate: string,
): string {
  return `laporan_statistik_bandara_${period}_${startDate}_${endDate}.xlsx`;
}
