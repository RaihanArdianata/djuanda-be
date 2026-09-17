import type { Alert } from "@repo/database";
import ExcelJs from "exceljs";

export interface AlertExportSummary {
  totalAlerts: number;
  runwayIncursion: number;
  shortTerm: number;
  deviation: number;
  areaPenetration: number;
  taxiwayAlert: number;
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

export async function generateExcelExport(
  alertsList: Alert[],
  summary: AlertExportSummary,
): Promise<Buffer> {
  const workbook = new ExcelJs.Workbook();
  workbook.creator = "A-SMGCS Juanda";
  workbook.created = new Date();

  // Worksheet 1: Alerts
  const alertsSheet = workbook.addWorksheet("Alerts");
  alertsSheet.columns = [
    { header: "Alert ID", key: "alertId", width: 25 },
    { header: "Alert Type", key: "type", width: 25 },
    { header: "Aircraft / Track ID", key: "trackId", width: 20 },
    { header: "Callsign", key: "callsign", width: 15 },
    { header: "ICAO24", key: "icao24", width: 12 },
    { header: "Airport", key: "airportId", width: 12 },
    { header: "Detected At", key: "detectedAt", width: 25 },
    { header: "Status", key: "status", width: 15 },
    { header: "Severity", key: "severity", width: 15 },
  ];
  alertsSheet.getRow(1).font = { bold: true };

  for (const alert of alertsList) {
    const data = (alert.data as Record<string, unknown> | null) ?? {};
    const callsign = (data.callsign as string | undefined) ?? "";
    const icao24 = (data.icao24 as string | undefined) ?? "";
    const detectedAt = alert.triggeredAt
      ? new Date(alert.triggeredAt).toISOString()
      : "";

    alertsSheet.addRow({
      alertId: alert.alertId,
      type: alert.type,
      trackId: alert.trackId,
      callsign,
      icao24,
      airportId: alert.airportId,
      detectedAt,
      status: alert.status,
      severity: alert.severity,
    });
  }

  // Worksheet 2: Summary
  const summarySheet = workbook.addWorksheet("Summary");
  summarySheet.columns = [
    { header: "Category", key: "category", width: 25 },
    { header: "Count", key: "count", width: 15 },
  ];
  summarySheet.getRow(1).font = { bold: true };

  summarySheet.addRow({ category: "Total Alerts", count: summary.totalAlerts });
  summarySheet.addRow({
    category: "Runway Incursion",
    count: summary.runwayIncursion,
  });
  summarySheet.addRow({ category: "Short Term", count: summary.shortTerm });
  summarySheet.addRow({ category: "Deviation", count: summary.deviation });
  summarySheet.addRow({
    category: "Area Penetration",
    count: summary.areaPenetration,
  });
  summarySheet.addRow({
    category: "Taxiway Alert",
    count: summary.taxiwayAlert,
  });

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
