import type { Alert } from "@repo/database";
import ExcelJs from "exceljs";
import { alertServiceEnv } from "../../../config/env";

export interface AlertExportSummary {
  totalAlerts: number;
  runwayIncursion: number;
  shortTerm: number;
  deviation: number;
  areaPenetration: number;
  taxiwayAlert: number;
}

export interface ExcelExportOptions {
  startDateTime?: Date;
  endDateTime?: Date;
  airportId?: string;
}

export interface OperationalTrendPoint {
  period: string;
  periodRange?: string;
  aircraft: number;
  groundVehicle: number;
  takeoff: number;
  landing: number;
  totalMovement: number;
  alerts: number;
}

export interface OperationalStatisticsResult {
  period: string;
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
}

async function fetchOperationalStatistics(
  startDate: Date,
  endDate: Date,
  airportId?: string,
  authToken?: string,
): Promise<OperationalStatisticsResult | null> {
  try {
    const formatDate = (d: Date): string => d.toISOString().split("T")[0];
    const url = new URL(
      `${alertServiceEnv.statisticsServiceUrl}/statistics/operational`,
    );
    url.searchParams.append("startDate", formatDate(startDate));
    url.searchParams.append("endDate", formatDate(endDate));
    url.searchParams.append("period", "monthly");
    if (airportId) {
      url.searchParams.append("airportId", airportId);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.data as OperationalStatisticsResult;
  } catch (_error) {
    return null;
  }
}

export function calculateAlertSummary(alertsList: Alert[]): AlertExportSummary {
  let runwayIncursion = 0;
  let shortTerm = 0;
  let deviation = 0;
  let areaPenetration = 0;
  let taxiwayAlert = 0;

  for (const alert of alertsList) {
    const type = alert.type.toUpperCase();
    if (type === "RUNWAY_INCURSION") {
      runwayIncursion += 1;
    } else if (type === "STCA" || type === "SHORT_TERM") {
      shortTerm += 1;
    } else if (type === "DEVIATION") {
      deviation += 1;
    } else if (type === "AREA_PENETRATION") {
      areaPenetration += 1;
    } else if (type === "TAXIWAY_APRON_INCURSION" || type === "TAXIWAY_ALERT") {
      taxiwayAlert += 1;
    }
  }

  return {
    totalAlerts: alertsList.length,
    runwayIncursion,
    shortTerm,
    deviation,
    areaPenetration,
    taxiwayAlert,
  };
}

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r")
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function generateCsvExport(alertsList: Alert[]): string {
  const headers = [
    "Alert ID",
    "Alert Type",
    "Aircraft / Track ID",
    "Callsign",
    "ICAO24",
    "Airport",
    "Detected At",
    "Status",
    "Severity",
  ];

  const rows = alertsList.map((alert) => {
    const data = (alert.data as Record<string, unknown> | null) ?? {};
    const callsign = (data.callsign as string | undefined) ?? "";
    const icao24 = (data.icao24 as string | undefined) ?? "";
    const detectedAt = alert.triggeredAt
      ? new Date(alert.triggeredAt).toISOString()
      : "";

    return [
      escapeCsv(alert.alertId),
      escapeCsv(alert.type),
      escapeCsv(alert.trackId),
      escapeCsv(callsign),
      escapeCsv(icao24),
      escapeCsv(alert.airportId),
      escapeCsv(detectedAt),
      escapeCsv(alert.status),
      escapeCsv(alert.severity),
    ].join(",");
  });

  return [headers.join(","), ...rows].join("\r\n");
}

const PALETTE = {
  navyHeader: "FF1F2A44",
  headerText: "FFFFFFFF",
  totalFill: "FFDCE6F1",
  zebraFill: "FFF2F2F2",
  whiteFill: "FFFFFFFF",
  blueText: "FF0000FF",
  titleText: "FF1F2A44",
  subtitleText: "FF595959",
  noteText: "FF808080",
  warningRed: "FFC0392B",
  borderColor: "FFBFBFBF",
  softBlueAlt: "FFEAF1F8",
  softGreen: "FFEAF6EC",
  softGreenAlt: "FFF5FBF6",
  softRed: "FFFDEDEC",
  yellowFill: "FFFFF2CC",
} as const;

const THIN_BORDER: Partial<ExcelJs.Borders> = {
  top: { style: "thin", color: { argb: PALETTE.borderColor } },
  bottom: { style: "thin", color: { argb: PALETTE.borderColor } },
  left: { style: "thin", color: { argb: PALETTE.borderColor } },
  right: { style: "thin", color: { argb: PALETTE.borderColor } },
};

function formatPeriodUppercase(start?: Date, end?: Date): string {
  if (!start && !end) return "01 JAN - 31 DES 2026";
  const months = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MEI",
    "JUN",
    "JUL",
    "AGU",
    "SEP",
    "OKT",
    "NOV",
    "DES",
  ];
  const formatSingle = (d: Date): string => {
    const day = String(d.getUTCDate()).padStart(2, "0");
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    return `${day} ${month} ${year}`;
  };

  if (start && end) {
    return `${formatSingle(start)} - ${formatSingle(end)}`;
  }
  if (start) return `MULAI ${formatSingle(start)}`;
  if (end) return `SAMPAI ${formatSingle(end)}`;
  return "01 JAN - 31 DES 2026";
}

function formatDateIndonesian(d: Date): string {
  const months = [
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
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

interface DominantAlert {
  name: string;
  count: number;
  row: number;
}

function getDominantAlert(summary: AlertExportSummary): DominantAlert {
  const categories: DominantAlert[] = [
    { name: "Runway Incursion", count: summary.runwayIncursion, row: 6 },
    { name: "Short Term", count: summary.shortTerm, row: 7 },
    { name: "Deviation", count: summary.deviation, row: 8 },
    { name: "Area Penetration", count: summary.areaPenetration, row: 9 },
    { name: "Taxiway Alert", count: summary.taxiwayAlert, row: 10 },
  ];
  const sorted = [...categories].sort((a, b) => b.count - a.count);
  return sorted[0]?.count && sorted[0].count > 0
    ? sorted[0]
    : { name: "Taxiway Alert", count: 0, row: 10 };
}

function _addAircraftActivitySection(
  sheet: ExcelJs.Worksheet,
  operationalStats?: OperationalStatisticsResult | null,
): void {
  const planeHeaders = [
    { col: "B", label: "Total Aktivitas", fill: PALETTE.totalFill },
    { col: "C", label: "Landing", fill: PALETTE.softBlueAlt },
    { col: "D", label: "Takeoff", fill: PALETTE.totalFill },
    { col: "E", label: "Peak Aktivitas", fill: PALETTE.softBlueAlt },
    { col: "F", label: "Rata-rata / jam", fill: PALETTE.totalFill },
  ];
  for (const h of planeHeaders) {
    const c = sheet.getCell(`${h.col}7`);
    c.value = h.label;
    c.font = { name: "Arial", size: 10 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: h.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  const planeValues = [
    {
      col: "B",
      val: {
        formula: "'Monthly Trend'!E18",
        result:
          (operationalStats?.movement.totalTakeoff ?? 0) +
          (operationalStats?.movement.totalLanding ?? 0),
      },
      fmt: "#,##0",
      fill: PALETTE.totalFill,
    },
    {
      col: "C",
      val: {
        formula: "'Monthly Trend'!C18",
        result: operationalStats?.movement.totalLanding ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.softBlueAlt,
    },
    {
      col: "D",
      val: {
        formula: "'Monthly Trend'!D18",
        result: operationalStats?.movement.totalTakeoff ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.totalFill,
    },
    {
      col: "E",
      val: {
        formula: "'Ground Traffic'!D6",
        result: operationalStats?.movement.peakHourMovement ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.softBlueAlt,
    },
    {
      col: "F",
      val: {
        formula: "'Ground Traffic'!D9",
        result: operationalStats?.movement.averageMovementPerHour ?? 0,
      },
      fmt: "#,##0.00",
      fill: PALETTE.totalFill,
    },
  ];

  for (const v of planeValues) {
    const c = sheet.getCell(`${v.col}8`);
    c.value = v.val;
    c.numFmt = v.fmt;
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: v.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }
}

function _addGroundTrafficSection(
  sheet: ExcelJs.Worksheet,
  operationalStats?: OperationalStatisticsResult | null,
): void {
  sheet.getCell("B11").value = "AKTIVITAS LALU LINTAS DARAT";
  sheet.getCell("B11").font = {
    name: "Arial",
    size: 12,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  const groundHeaders = [
    { col: "B", label: "Total Trafik", fill: PALETTE.totalFill },
    { col: "C", label: "Pesawat Terbang", fill: PALETTE.softBlueAlt },
    { col: "D", label: "Kendaraan Darat", fill: PALETTE.totalFill },
  ];
  for (const h of groundHeaders) {
    const c = sheet.getCell(`${h.col}12`);
    c.value = h.label;
    c.font = { name: "Arial", size: 10 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: h.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  const groundValues = [
    {
      col: "B",
      val: {
        formula: "'Ground Traffic'!D7",
        result: operationalStats?.traffic.totalTraffic ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.totalFill,
    },
    {
      col: "C",
      val: {
        formula: "'Ground Traffic'!D8",
        result: operationalStats?.traffic.totalAircraft ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.softBlueAlt,
    },
    {
      col: "D",
      val: {
        formula: "'Ground Traffic'!D9",
        result: operationalStats?.traffic.totalGroundVehicle ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.totalFill,
    },
  ];

  for (const v of groundValues) {
    const c = sheet.getCell(`${v.col}13`);
    c.value = v.val;
    c.numFmt = v.fmt;
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: v.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Function complexity is acceptable for Excel sheet generation
function buildExecutiveSummarySheet(
  workbook: ExcelJs.Workbook,
  summary: AlertExportSummary,
  periodText: string,
  airportCode: string,
  operationalStats?: OperationalStatisticsResult | null,
): void {
  const dominant = getDominantAlert(summary);
  const sheet = workbook.addWorksheet("Executive Summary", {
    views: [{ showGridLines: true }],
  });
  sheet.columns = [
    { width: 3 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 20 },
    { width: 3 },
  ];

  sheet.getCell("B2").value = "LAPORAN STATISTIK AKTIVITAS BANDARA";
  sheet.getCell("B2").font = {
    name: "Arial",
    size: 16,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  sheet.getCell("B3").value =
    `Juanda International Airport (${airportCode})  |  Periode: ${periodText}`;
  sheet.getCell("B3").font = {
    name: "Arial",
    size: 10,
    italic: true,
    color: { argb: PALETTE.subtitleText },
  };

  sheet.getCell("B4").value =
    "Sumber data: Dashboard Statistics. Lihat sheet 'Legend & Notes' untuk asumsi.";
  sheet.getCell("B4").font = {
    name: "Arial",
    size: 9,
    italic: true,
    color: { argb: PALETTE.subtitleText },
  };

  sheet.getCell("B6").value = "AKTIVITAS PESAWAT TERBANG";
  sheet.getCell("B6").font = {
    name: "Arial",
    size: 12,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  const planeHeaders = [
    { col: "B", label: "Total Aktivitas", fill: PALETTE.totalFill },
    { col: "C", label: "Landing", fill: PALETTE.softBlueAlt },
    { col: "D", label: "Takeoff", fill: PALETTE.totalFill },
    { col: "E", label: "Peak Aktivitas", fill: PALETTE.softBlueAlt },
    { col: "F", label: "Rata-rata / jam", fill: PALETTE.totalFill },
  ];
  for (const h of planeHeaders) {
    const c = sheet.getCell(`${h.col}7`);
    c.value = h.label;
    c.font = { name: "Arial", size: 10 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: h.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  const planeValues = [
    {
      col: "B",
      val: {
        formula: "'Monthly Trend'!E18",
        result:
          (operationalStats?.movement.totalTakeoff ?? 0) +
          (operationalStats?.movement.totalLanding ?? 0),
      },
      fmt: "#,##0",
      fill: PALETTE.totalFill,
    },
    {
      col: "C",
      val: {
        formula: "'Monthly Trend'!C18",
        result: operationalStats?.movement.totalLanding ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.softBlueAlt,
    },
    {
      col: "D",
      val: {
        formula: "'Monthly Trend'!D18",
        result: operationalStats?.movement.totalTakeoff ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.totalFill,
    },
    {
      col: "E",
      val: operationalStats?.movement.peakHourMovement ?? 0,
      fmt: "#,##0",
      fill: PALETTE.softBlueAlt,
    },
    {
      col: "F",
      val: operationalStats?.movement.averageMovementPerHour ?? 0,
      fmt: "0.00",
      fill: PALETTE.totalFill,
    },
  ];
  for (const v of planeValues) {
    const c = sheet.getCell(`${v.col}8`);
    c.value = v.val;
    c.numFmt = v.fmt;
    c.font = { name: "Arial", size: 14, bold: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: v.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  const planeUnits = [
    { col: "B", label: "pergerakan", fill: PALETTE.totalFill },
    { col: "C", label: "pergerakan", fill: PALETTE.softBlueAlt },
    { col: "D", label: "pergerakan", fill: PALETTE.totalFill },
    { col: "E", label: "pada pukul 09:00", fill: PALETTE.softBlueAlt },
    { col: "F", label: "pergerakan per jam", fill: PALETTE.totalFill },
  ];
  for (const u of planeUnits) {
    const c = sheet.getCell(`${u.col}9`);
    c.value = u.label;
    c.font = { name: "Arial", size: 8 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: u.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  sheet.getCell("B11").value = "AKTIVITAS LALU LINTAS DARAT";
  sheet.getCell("B11").font = {
    name: "Arial",
    size: 12,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  const groundHeaders = [
    { col: "B", label: "Total Trafik", fill: PALETTE.softGreen },
    { col: "C", label: "Pesawat Terbang", fill: PALETTE.softGreenAlt },
    { col: "D", label: "Kendaraan Darat", fill: PALETTE.softGreen },
    { col: "E", label: "Peak Aktivitas", fill: PALETTE.softGreenAlt },
  ];
  for (const h of groundHeaders) {
    const c = sheet.getCell(`${h.col}12`);
    c.value = h.label;
    c.font = { name: "Arial", size: 10 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: h.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  const groundValues = [
    {
      col: "B",
      val: {
        formula: "'Ground Traffic'!D7",
        result: operationalStats?.traffic.totalTraffic ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.softGreen,
    },
    {
      col: "C",
      val: {
        formula: "'Ground Traffic'!D9",
        result: operationalStats?.traffic.totalAircraft ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.softGreenAlt,
    },
    {
      col: "D",
      val: {
        formula: "'Ground Traffic'!D10",
        result: operationalStats?.traffic.totalGroundVehicle ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.softGreen,
    },
    {
      col: "E",
      val: {
        formula: "'Ground Traffic'!D6",
        result: operationalStats?.movement.peakHourMovement ?? 0,
      },
      fmt: "#,##0",
      fill: PALETTE.softGreenAlt,
    },
  ];
  for (const v of groundValues) {
    const c = sheet.getCell(`${v.col}13`);
    c.value = v.val;
    c.numFmt = v.fmt;
    c.font = { name: "Arial", size: 14, bold: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: v.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  const groundUnits = [
    { col: "B", label: "pergerakan", fill: PALETTE.softGreen },
    { col: "C", label: "pergerakan", fill: PALETTE.softGreenAlt },
    { col: "D", label: "pergerakan", fill: PALETTE.softGreen },
    { col: "E", label: "pergerakan (puncak)", fill: PALETTE.softGreenAlt },
  ];
  for (const u of groundUnits) {
    const c = sheet.getCell(`${u.col}14`);
    c.value = u.label;
    c.font = { name: "Arial", size: 8 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: u.fill },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  sheet.getCell("B16").value = `RINGKASAN ALERT (${periodText})`;
  sheet.getCell("B16").font = {
    name: "Arial",
    size: 12,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  const alertCardHeaders = [
    { col: "B", label: "Total Alerts" },
    { col: "D", label: "Kategori Dominan" },
    { col: "E", label: "% dari Total" },
  ];
  for (const h of alertCardHeaders) {
    const c = sheet.getCell(`${h.col}17`);
    c.value = h.label;
    c.font = { name: "Arial", size: 10 };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.softRed },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  const alertCardValues = [
    {
      col: "B",
      val: {
        formula: "'Alert Summary'!C11",
        result: summary.totalAlerts,
      },
      fmt: "#,##0",
      fontSize: 18,
    },
    { col: "D", val: dominant.name, fmt: undefined, fontSize: 14 },
    {
      col: "E",
      val: {
        formula: `'Alert Summary'!D${dominant.row}`,
        result:
          summary.totalAlerts > 0 ? dominant.count / summary.totalAlerts : 0,
      },
      fmt: "0.0%",
      fontSize: 14,
    },
  ];
  for (const v of alertCardValues) {
    const c = sheet.getCell(`${v.col}18`);
    c.value = v.val;
    if (v.fmt) c.numFmt = v.fmt;
    c.font = { name: "Arial", size: v.fontSize, bold: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.softRed },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }
}

function buildMonthlyTrendSheet(
  workbook: ExcelJs.Workbook,
  currentYear: number,
  operationalStats?: OperationalStatisticsResult | null,
): void {
  const sheet = workbook.addWorksheet("Monthly Trend", {
    views: [{ showGridLines: true }],
  });
  sheet.columns = [
    { width: 3 },
    { width: 16 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 20 },
    { width: 3 },
  ];

  sheet.getCell("B2").value = `AKTIVITAS PESAWAT PER BULAN - ${currentYear}`;
  sheet.getCell("B2").font = {
    name: "Arial",
    size: 16,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  sheet.getCell("B3").value =
    "Sumber: chart 'Aktivitas per Bulan' & detail breakdown pada dashboard Statistics";
  sheet.getCell("B3").font = {
    name: "Arial",
    size: 10,
    italic: true,
    color: { argb: PALETTE.subtitleText },
  };

  const trendHeaderCols = [
    { col: "B", label: "Bulan" },
    { col: "C", label: "Landing" },
    { col: "D", label: "Takeoff" },
    { col: "E", label: "Total" },
    { col: "F", label: "% dari Total Tahunan" },
  ];
  for (const h of trendHeaderCols) {
    const c = sheet.getCell(`${h.col}5`);
    c.value = h.label;
    c.font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: PALETTE.headerText },
    };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.navyHeader },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }
  sheet.getRow(5).height = 24;

  const months = [
    { name: "Januari", landing: 0, takeoff: 0 },
    { name: "Februari", landing: 0, takeoff: 0 },
    { name: "Maret", landing: 0, takeoff: 0 },
    { name: "April", landing: 0, takeoff: 0 },
    { name: "Mei", landing: 0, takeoff: 0 },
    { name: "Juni", landing: 0, takeoff: 0 },
    { name: "Juli", landing: 0, takeoff: 0 },
    { name: "Agustus", landing: 0, takeoff: 0 },
    { name: "September", landing: 0, takeoff: 0 },
    { name: "Oktober", landing: 0, takeoff: 0 },
    { name: "November", landing: 0, takeoff: 0 },
    { name: "Desember", landing: 0, takeoff: 0 },
  ];

  // Populate with real data from statistics service if available
  if (operationalStats?.trend) {
    for (const trendPoint of operationalStats.trend) {
      const monthIndex = new Date(trendPoint.period).getUTCMonth();
      if (monthIndex >= 0 && monthIndex < 12) {
        months[monthIndex].landing = trendPoint.landing;
        months[monthIndex].takeoff = trendPoint.takeoff;
      }
    }
  }

  months.forEach((m, idx) => {
    const r = 6 + idx;
    const isEven = idx % 2 === 1;
    const fillArg = isEven ? PALETTE.zebraFill : PALETTE.whiteFill;

    sheet.getCell(`B${r}`).value = m.name;
    sheet.getCell(`C${r}`).value = m.landing;
    sheet.getCell(`D${r}`).value = m.takeoff;
    sheet.getCell(`E${r}`).value = { formula: `C${r}+D${r}` };
    sheet.getCell(`F${r}`).value = { formula: `E${r}/$E$18` };

    sheet.getCell(`C${r}`).numFmt = "#,##0";
    sheet.getCell(`D${r}`).numFmt = "#,##0";
    sheet.getCell(`E${r}`).numFmt = "#,##0";
    sheet.getCell(`F${r}`).numFmt = "0.0%";

    for (const c of ["B", "C", "D", "E", "F"]) {
      const cell = sheet.getCell(`${c}${r}`);
      cell.font = {
        name: "Arial",
        size: 10,
        color: c === "C" || c === "D" ? { argb: PALETTE.blueText } : undefined,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: fillArg },
      };
      cell.border = THIN_BORDER;
    }
  });

  sheet.getCell("B18").value = "TOTAL";
  sheet.getCell("C18").value = { formula: "SUM(C6:C17)", result: 9509 };
  sheet.getCell("D18").value = { formula: "SUM(D6:D17)", result: 31152 };
  sheet.getCell("E18").value = { formula: "SUM(E6:E17)", result: 40661 };
  sheet.getCell("F18").value = { formula: "E18/$E$18", result: 1 };

  sheet.getCell("C18").numFmt = "#,##0";
  sheet.getCell("D18").numFmt = "#,##0";
  sheet.getCell("E18").numFmt = "#,##0";
  sheet.getCell("F18").numFmt = "0.0%";

  for (const c of ["B", "C", "D", "E", "F"]) {
    const cell = sheet.getCell(`${c}18`);
    cell.font = { name: "Arial", size: 10, bold: true };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.totalFill },
    };
    cell.border = THIN_BORDER;
  }

  sheet.mergeCells("B20:F20");
  sheet.getCell("B20").value =
    "Catatan: Bulan selain Agustus & September menunjukkan 0 aktivitas pada grafik dashboard (kemungkinan sistem baru mulai mencatat data pada periode tsb). Update sel biru (Landing/Takeoff) dengan data export lengkap saat tersedia.";
  sheet.getCell("B20").font = {
    name: "Arial",
    size: 9,
    italic: true,
    color: { argb: PALETTE.noteText },
  };
  sheet.getCell("B20").alignment = { wrapText: true };
  sheet.getRow(20).height = 30;
}

function buildGroundTrafficSheet(
  workbook: ExcelJs.Workbook,
  currentYear: number,
  operationalStats?: OperationalStatisticsResult | null,
): void {
  const sheet = workbook.addWorksheet("Ground Traffic", {
    views: [{ showGridLines: true }],
  });
  sheet.columns = [
    { width: 3 },
    { width: 26 },
    { width: 3 },
    { width: 18 },
    { width: 30 },
    { width: 3 },
  ];

  sheet.getCell("B2").value =
    `AKTIVITAS LALU LINTAS BANDARA (DARAT) - ${currentYear}`;
  sheet.getCell("B2").font = {
    name: "Arial",
    size: 16,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  sheet.getCell("B3").value =
    "Sumber: panel 'Aktivitas Lalu Lintas Bandara' pada dashboard Statistics";
  sheet.getCell("B3").font = {
    name: "Arial",
    size: 10,
    italic: true,
    color: { argb: PALETTE.subtitleText },
  };

  for (const [col, label] of [
    ["B", "Metrik"],
    ["D", "Nilai"],
  ] as const) {
    const c = sheet.getCell(`${col}5`);
    c.value = label;
    c.font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: PALETTE.headerText },
    };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.navyHeader },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }

  const groundRows = [
    {
      row: 6,
      label: "Peak Aktivitas",
      val: operationalStats?.movement.peakHourMovement ?? 0,
      unit: operationalStats?.movement.peakHour
        ? `pergerakan (puncak pada ${operationalStats.movement.peakHour})`
        : "pergerakan (puncak)",
      fill: PALETTE.zebraFill,
    },
    {
      row: 7,
      label: "Total Trafik",
      val: operationalStats?.traffic.totalTraffic ?? 0,
      unit: "pergerakan",
      fill: PALETTE.whiteFill,
    },
    {
      row: 8,
      label: "Rata-rata per Hari",
      val: operationalStats?.movement.averageMovementPerHour ?? 0,
      unit: "pergerakan per jam",
      fill: PALETTE.zebraFill,
    },
    {
      row: 9,
      label: "Pesawat Terbang",
      val: operationalStats?.traffic.totalAircraft ?? 0,
      unit: "pergerakan",
      fill: PALETTE.whiteFill,
    },
    {
      row: 10,
      label: "Kendaraan Darat",
      val: operationalStats?.traffic.totalGroundVehicle ?? 0,
      unit: "pergerakan",
      fill: PALETTE.zebraFill,
    },
  ];

  for (const gr of groundRows) {
    const b = sheet.getCell(`B${gr.row}`);
    b.value = gr.label;
    b.font = { name: "Arial", size: 10 };
    b.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: gr.fill },
    };
    b.border = THIN_BORDER;

    const d = sheet.getCell(`D${gr.row}`);
    d.value = gr.val;
    d.numFmt = "#,##0";
    d.font = {
      name: "Arial",
      size: 10,
      color: { argb: PALETTE.blueText },
    };
    d.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: gr.fill },
    };
    d.border = THIN_BORDER;

    const e = sheet.getCell(`E${gr.row}`);
    e.value = gr.unit;
    e.font = {
      name: "Arial",
      size: 9,
      color: { argb: PALETTE.subtitleText },
    };
  }

  sheet.getCell("B11").value = "% Pesawat Terbang dari Total Trafik";
  sheet.getCell("B11").font = { name: "Arial", size: 10, bold: true };
  sheet.getCell("B11").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: PALETTE.totalFill },
  };
  sheet.getCell("B11").border = THIN_BORDER;

  sheet.getCell("D11").value = { formula: "D9/D7", result: 1 };
  sheet.getCell("D11").numFmt = "0.0%";
  sheet.getCell("D11").font = { name: "Arial", size: 10, bold: true };
  sheet.getCell("D11").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: PALETTE.totalFill },
  };
  sheet.getCell("D11").border = THIN_BORDER;

  sheet.getCell("B13").value =
    "RINCIAN BULANAN (opsional - isi setelah export data tersedia)";
  sheet.getCell("B13").font = {
    name: "Arial",
    size: 12,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  sheet.getCell("B14").value = "Bulan";
  sheet.getCell("D14").value = "Total Trafik";
  for (const c of ["B", "D"]) {
    const cell = sheet.getCell(`${c}14`);
    cell.font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: PALETTE.headerText },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.navyHeader },
    };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = THIN_BORDER;
  }

  const monthNames = [
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
  ];
  monthNames.forEach((name, idx) => {
    const r = 15 + idx;
    sheet.getCell(`B${r}`).value = name;
    sheet.getCell(`B${r}`).font = { name: "Arial", size: 10 };
    sheet.getCell(`B${r}`).border = THIN_BORDER;

    sheet.getCell(`D${r}`).border = THIN_BORDER;
    sheet.getCell(`D${r}`).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.yellowFill },
    };
  });

  sheet.mergeCells("B28:E28");
  sheet.getCell("B28").value =
    "Catatan: grafik pada dashboard menunjukkan aktivitas hanya di Agustus & September, namun skala sumbu-Y pada screenshot tidak terbaca jelas sehingga angka pasti per bulan tidak dapat diekstrak. Isi sel kuning di atas dari 'Export All Data' untuk melengkapi.";
  sheet.getCell("B28").font = {
    name: "Arial",
    size: 9,
    italic: true,
    color: { argb: PALETTE.noteText },
  };
  sheet.getCell("B28").alignment = { wrapText: true };
  sheet.getRow(28).height = 45;
}

function buildAlertSummarySheet(
  workbook: ExcelJs.Workbook,
  summary: AlertExportSummary,
  periodText: string,
): void {
  const dominant = getDominantAlert(summary);
  const dominantPercentageStr =
    summary.totalAlerts > 0
      ? `${((dominant.count / summary.totalAlerts) * 100).toFixed(1)}%`
      : "0.0%";

  const sheet = workbook.addWorksheet("Alert Summary", {
    views: [{ showGridLines: true }],
  });
  sheet.columns = [
    { width: 3 },
    { width: 22 },
    { width: 14 },
    { width: 14 },
    { width: 3 },
  ];

  sheet.getCell("B2").value = `RINGKASAN ALERT - PERIODE ${periodText}`;
  sheet.getCell("B2").font = {
    name: "Arial",
    size: 16,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  sheet.getCell("B3").value =
    "Sumber: panel 'Ringkasan Alert' pada dashboard Statistics";
  sheet.getCell("B3").font = {
    name: "Arial",
    size: 10,
    italic: true,
    color: { argb: PALETTE.subtitleText },
  };

  for (const [col, label] of [
    ["B", "Kategori"],
    ["C", "Jumlah"],
    ["D", "% dari Total"],
  ] as const) {
    const c = sheet.getCell(`${col}5`);
    c.value = label;
    c.font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: PALETTE.headerText },
    };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.navyHeader },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }
  sheet.getRow(5).height = 24;

  const alertCategories = [
    { row: 6, label: "Runway Incursion", count: summary.runwayIncursion },
    { row: 7, label: "Short Term", count: summary.shortTerm },
    { row: 8, label: "Deviation", count: summary.deviation },
    { row: 9, label: "Area Penetration", count: summary.areaPenetration },
    { row: 10, label: "Taxiway Alert", count: summary.taxiwayAlert },
  ];

  alertCategories.forEach((cat, idx) => {
    const isEven = idx % 2 === 0;
    const fillArg = isEven ? PALETTE.zebraFill : PALETTE.whiteFill;

    const b = sheet.getCell(`B${cat.row}`);
    b.value = cat.label;
    b.font = { name: "Arial", size: 10 };
    b.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: fillArg },
    };
    b.border = THIN_BORDER;

    const c = sheet.getCell(`C${cat.row}`);
    c.value = cat.count;
    c.numFmt = "#,##0";
    c.font = {
      name: "Arial",
      size: 10,
      color: { argb: PALETTE.blueText },
    };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: fillArg },
    };
    c.border = THIN_BORDER;

    const d = sheet.getCell(`D${cat.row}`);
    const pct = summary.totalAlerts > 0 ? cat.count / summary.totalAlerts : 0;
    d.value = { formula: `C${cat.row}/$C$11`, result: pct };
    d.numFmt = "0.0%";
    d.font = { name: "Arial", size: 10 };
    d.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: fillArg },
    };
    d.border = THIN_BORDER;
  });

  sheet.getCell("B11").value = "TOTAL";
  sheet.getCell("C11").value = {
    formula: "SUM(C6:C10)",
    result: summary.totalAlerts,
  };
  sheet.getCell("D11").value = {
    formula: "C11/$C$11",
    result: summary.totalAlerts > 0 ? 1 : 0,
  };

  sheet.getCell("C11").numFmt = "#,##0";
  sheet.getCell("D11").numFmt = "0.0%";

  for (const col of ["B", "C", "D"]) {
    const c = sheet.getCell(`${col}11`);
    c.font = { name: "Arial", size: 10, bold: true };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.totalFill },
    };
    c.border = THIN_BORDER;
  }

  sheet.mergeCells("B13:D13");
  const alertNoteText =
    summary.totalAlerts > 0
      ? `Catatan: ${dominant.name} mendominasi (~${dominantPercentageStr} dari total alert). Disarankan investigasi lanjut terhadap penyebab alert yang tinggi dibanding kategori lain.`
      : "Catatan: Tidak terdapat alert yang tercatat pada rentang periode yang dipilih.";
  sheet.getCell("B13").value = alertNoteText;
  sheet.getCell("B13").font = {
    name: "Arial",
    size: 9,
    italic: true,
    color: { argb: PALETTE.noteText },
  };
  sheet.getCell("B13").alignment = { wrapText: true };
  sheet.getRow(13).height = 30;
}

const DETAIL_HEADERS = [
  { col: "B", label: "Tanggal" },
  { col: "C", label: "Waktu" },
  { col: "D", label: "Callsign" },
  { col: "E", label: "Tipe Alert" },
  { col: "F", label: "Severity" },
  { col: "G", label: "Status" },
  { col: "H", label: "Alert ID" },
  { col: "I", label: "Track ID" },
  { col: "J", label: "Airport" },
];

function formatAlertDate(dateInput: Date | string | null): {
  dateStr: string;
  timeStr: string;
} {
  if (!dateInput) return { dateStr: "-", timeStr: "-" };
  const d = new Date(dateInput);
  const dateStr = `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
  const pad = (n: number): string => String(n).padStart(2, "0");
  const timeStr = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return { dateStr, timeStr };
}

const CENTERED_COLS = new Set(["B", "C", "F", "G", "J"]);
const BLUE_TEXT_COLS = new Set(["B", "C", "D"]);

function styleDetailRowCell(
  cell: ExcelJs.Cell,
  col: string,
  fillArg: string,
): void {
  cell.font = {
    name: "Arial",
    size: 10,
    color: BLUE_TEXT_COLS.has(col) ? { argb: PALETTE.blueText } : undefined,
  };
  cell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: fillArg },
  };
  cell.border = THIN_BORDER;
  if (CENTERED_COLS.has(col)) {
    cell.alignment = { horizontal: "center", vertical: "middle" };
  }
}

function renderDetailLogRows(
  sheet: ExcelJs.Worksheet,
  alertsList: Alert[],
): number {
  let currentRow = 6;
  for (const alert of alertsList) {
    const data = (alert.data as Record<string, unknown> | null) ?? {};
    const callsign = (data.callsign as string | undefined) ?? "-";
    const { dateStr, timeStr } = formatAlertDate(alert.triggeredAt);
    const isEven = (currentRow - 6) % 2 === 1;
    const fillArg = isEven ? PALETTE.zebraFill : PALETTE.whiteFill;

    sheet.getCell(`B${currentRow}`).value = dateStr;
    sheet.getCell(`C${currentRow}`).value = timeStr;
    sheet.getCell(`D${currentRow}`).value = callsign;
    sheet.getCell(`E${currentRow}`).value = alert.type;
    sheet.getCell(`F${currentRow}`).value = alert.severity;
    sheet.getCell(`G${currentRow}`).value = alert.status;
    sheet.getCell(`H${currentRow}`).value = alert.alertId;
    sheet.getCell(`I${currentRow}`).value = alert.trackId;
    sheet.getCell(`J${currentRow}`).value = alert.airportId;

    for (const h of DETAIL_HEADERS) {
      styleDetailRowCell(
        sheet.getCell(`${h.col}${currentRow}`),
        h.col,
        fillArg,
      );
    }
    currentRow += 1;
  }
  return currentRow;
}

function renderDetailLogSummary(
  sheet: ExcelJs.Worksheet,
  alertsList: Alert[],
  lastDataRow: number,
  summaryStartRow: number,
): void {
  sheet.getCell(`B${summaryStartRow}`).value =
    "Ringkasan (dari data pada tabel di atas):";
  sheet.getCell(`B${summaryStartRow}`).font = {
    name: "Arial",
    size: 10,
    bold: true,
  };

  const countFormula =
    alertsList.length > 0 ? `COUNTA(D6:D${lastDataRow})` : "0";

  sheet.getCell(`B${summaryStartRow + 1}`).value = "Total Alerts Terdaftar";
  sheet.getCell(`B${summaryStartRow + 1}`).font = { name: "Arial", size: 10 };
  const countCell = sheet.getCell(`D${summaryStartRow + 1}`);
  countCell.value = { formula: countFormula, result: alertsList.length };
  countCell.numFmt = "#,##0";
  countCell.font = { name: "Arial", size: 10, bold: true };

  sheet.getCell(`B${summaryStartRow + 2}`).value = "Jumlah Severity - HIGH";
  sheet.getCell(`B${summaryStartRow + 2}`).font = { name: "Arial", size: 10 };
  const highCell = sheet.getCell(`D${summaryStartRow + 2}`);
  highCell.value = {
    formula: `COUNTIF(F6:F${lastDataRow},"HIGH")`,
    result: alertsList.filter((a) => a.severity === "HIGH").length,
  };
  highCell.numFmt = "#,##0";
  highCell.font = { name: "Arial", size: 10 };

  sheet.getCell(`B${summaryStartRow + 3}`).value = "Jumlah Severity - MEDIUM";
  sheet.getCell(`B${summaryStartRow + 3}`).font = { name: "Arial", size: 10 };
  const medCell = sheet.getCell(`D${summaryStartRow + 3}`);
  medCell.value = {
    formula: `COUNTIF(F6:F${lastDataRow},"MEDIUM")`,
    result: alertsList.filter((a) => a.severity === "MEDIUM").length,
  };
  medCell.numFmt = "#,##0";
  medCell.font = { name: "Arial", size: 10 };

  sheet.getCell(`B${summaryStartRow + 4}`).value = "Jumlah Severity - LOW";
  sheet.getCell(`B${summaryStartRow + 4}`).font = { name: "Arial", size: 10 };
  const lowCell = sheet.getCell(`D${summaryStartRow + 4}`);
  lowCell.value = {
    formula: `COUNTIF(F6:F${lastDataRow},"LOW")`,
    result: alertsList.filter((a) => a.severity === "LOW").length,
  };
  lowCell.numFmt = "#,##0";
  lowCell.font = { name: "Arial", size: 10 };

  const noteRow = summaryStartRow + 6;
  sheet.mergeCells(`B${noteRow}:J${noteRow}`);
  sheet.getCell(`B${noteRow}`).value =
    "Formula COUNTA/COUNTIF di atas otomatis ter-update jika data alert disaring atau diperbarui sesuai periode.";
  sheet.getCell(`B${noteRow}`).font = {
    name: "Arial",
    size: 9,
    italic: true,
    color: { argb: PALETTE.noteText },
  };
}

function buildDetailLogSheet(
  workbook: ExcelJs.Workbook,
  alertsList: Alert[],
  periodText: string,
  airportCode: string,
): void {
  const sheet = workbook.addWorksheet("Detail Log", {
    views: [{ showGridLines: true }],
  });
  sheet.columns = [
    { width: 3 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 26 },
    { width: 14 },
    { width: 14 },
    { width: 22 },
    { width: 18 },
    { width: 12 },
    { width: 3 },
  ];

  sheet.getCell("B2").value =
    `DETAIL LOG ALERT - BANDARA JUANDA (${airportCode})`;
  sheet.getCell("B2").font = {
    name: "Arial",
    size: 16,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  const detailSubtitle =
    alertsList.length > 0
      ? `Data Alert Periode: ${periodText}  |  Total Data: ${alertsList.length} alert(s)`
      : "⚠️ PERINGATAN: Tidak ada alert pada periode yang dipilih. Data kosong.";
  sheet.getCell("B3").value = detailSubtitle;
  sheet.getCell("B3").font = {
    name: "Arial",
    size: 9,
    bold: alertsList.length === 0,
    italic: alertsList.length > 0,
    color: {
      argb: alertsList.length === 0 ? PALETTE.warningRed : PALETTE.subtitleText,
    },
  };
  sheet.mergeCells("B3:J3");

  for (const h of DETAIL_HEADERS) {
    const c = sheet.getCell(`${h.col}5`);
    c.value = h.label;
    c.font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: PALETTE.headerText },
    };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.navyHeader },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }
  sheet.getRow(5).height = 24;

  const currentRow = renderDetailLogRows(sheet, alertsList);
  const summaryStartRow = Math.max(currentRow + 1, 13);
  const lastDataRow = currentRow > 6 ? currentRow - 1 : 6;
  renderDetailLogSummary(sheet, alertsList, lastDataRow, summaryStartRow);
}

function buildLegendAndNotesSheet(
  workbook: ExcelJs.Workbook,
  airportCode: string,
): void {
  const sheet = workbook.addWorksheet("Legend & Notes", {
    views: [{ showGridLines: true }],
  });
  sheet.columns = [{ width: 3 }, { width: 30 }, { width: 60 }, { width: 3 }];

  sheet.getCell("B2").value = "LEGENDA & CATATAN PENGGUNAAN";
  sheet.getCell("B2").font = {
    name: "Arial",
    size: 16,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  for (const [col, label] of [
    ["B", "Kode Warna"],
    ["C", "Arti"],
  ] as const) {
    const c = sheet.getCell(`${col}4`);
    c.value = label;
    c.font = {
      name: "Arial",
      size: 11,
      bold: true,
      color: { argb: PALETTE.headerText },
    };
    c.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: PALETTE.navyHeader },
    };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = THIN_BORDER;
  }
  sheet.getRow(4).height = 24;

  const colorCodes = [
    {
      row: 5,
      code: "Teks biru",
      meaning:
        "Angka hasil input manual atau data langsung dari sistem A-SMGCS.",
      fill: PALETTE.whiteFill,
    },
    {
      row: 6,
      code: "Teks hitam",
      meaning:
        "Hasil formula - dihitung otomatis dari sel lain, jangan diketik manual.",
      fill: PALETTE.whiteFill,
    },
    {
      row: 7,
      code: "Fill kuning",
      meaning:
        "Sel yang perlu diisi/dilengkapi dengan data export penuh dari dashboard ('Export All Data').",
      fill: PALETTE.yellowFill,
    },
  ];

  for (const cc of colorCodes) {
    const b = sheet.getCell(`B${cc.row}`);
    b.value = cc.code;
    b.font = { name: "Arial", size: 10, bold: true };
    b.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: cc.fill },
    };
    b.border = THIN_BORDER;

    const c = sheet.getCell(`C${cc.row}`);
    c.value = cc.meaning;
    c.font = { name: "Arial", size: 10 };
    c.border = THIN_BORDER;
  }

  sheet.getCell("B9").value = "Sumber & Asumsi Data";
  sheet.getCell("B9").font = {
    name: "Arial",
    size: 12,
    bold: true,
    color: { argb: PALETTE.titleText },
  };

  const assumptions = [
    {
      row: 10,
      text: `Semua data alert dan statistik pada sheet ini digenerate secara otomatis dari database sistem A-SMGCS (${airportCode}) per ${formatDateIndonesian(new Date())}.`,
    },
    {
      row: 11,
      text: "Tabel 'Detail Log' menampilkan seluruh rekaman alert yang terdeteksi pada rentang waktu yang dipilih oleh pengguna.",
    },
    {
      row: 12,
      text: "Rincian bulanan pada sheet 'Ground Traffic' dan 'Monthly Trend' disediakan sebagai kompilasi statistik tahunan trafik bandara.",
    },
    {
      row: 13,
      text: "Untuk laporan yang benar-benar lengkap dan akurat, seluruh formula pada 'Executive Summary' akan otomatis ter-update berdasarkan data yang terisi pada 'Monthly Trend', 'Ground Traffic', dan 'Alert Summary'.",
    },
  ];

  for (const a of assumptions) {
    sheet.mergeCells(`B${a.row}:C${a.row}`);
    const c = sheet.getCell(`B${a.row}`);
    c.value = a.text;
    c.font = { name: "Arial", size: 10 };
    c.alignment = { wrapText: true };
    sheet.getRow(a.row).height = 36;
  }
}

export async function generateExcelExport(
  alertsList: Alert[],
  summary: AlertExportSummary,
  options?: ExcelExportOptions,
  authToken?: string,
): Promise<Buffer> {
  const workbook = new ExcelJs.Workbook();
  workbook.creator = "A-SMGCS Juanda";
  workbook.created = new Date();

  const periodText = formatPeriodUppercase(
    options?.startDateTime,
    options?.endDateTime,
  );
  const airportCode = options?.airportId || "WARR";
  const currentYear = options?.startDateTime
    ? options.startDateTime.getUTCFullYear()
    : new Date().getFullYear();

  // Fetch operational statistics from statistics service
  const operationalStats = await fetchOperationalStatistics(
    options?.startDateTime || new Date(),
    options?.endDateTime || new Date(),
    options?.airportId,
    authToken,
  );

  buildExecutiveSummarySheet(
    workbook,
    summary,
    periodText,
    airportCode,
    operationalStats,
  );
  buildMonthlyTrendSheet(workbook, currentYear, operationalStats);
  buildGroundTrafficSheet(workbook, currentYear, operationalStats);
  buildAlertSummarySheet(workbook, summary, periodText);
  buildDetailLogSheet(workbook, alertsList, periodText, airportCode);
  buildLegendAndNotesSheet(workbook, airportCode);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function formatExportFilename(
  start: Date,
  end: Date,
  ext: "csv" | "xlsx",
): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const formatDate = (d: Date): string =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;

  return `alerts_${formatDate(start)}_${formatDate(end)}.${ext}`;
}
