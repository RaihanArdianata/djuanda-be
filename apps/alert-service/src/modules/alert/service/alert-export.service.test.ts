import { describe, expect, it } from "bun:test";
import type { Alert } from "@repo/database";
import ExcelJs from "exceljs";
import {
  type AlertExportSummary,
  calculateAlertSummary,
  formatExportFilename,
  generateCsvExport,
  generateExcelExport,
} from "./alert-export.service";

const mockAlert = (overrides: Partial<Alert> = {}): Alert =>
  ({
    id: "uuid-1",
    alertId: "alert_001",
    airportId: "WARR",
    type: "RUNWAY_INCURSION",
    severity: "HIGH",
    status: "ACTIVE",
    trackId: "track-123",
    relatedTrackId: null,
    triggeredAt: new Date("2026-07-27T10:30:00.000Z"),
    acknowledgedAt: null,
    acknowledgedBy: null,
    clearedAt: null,
    clearedBy: null,
    notamId: null,
    ashtamId: null,
    aftnMessageId: null,
    aerodromeFeatureId: null,
    data: {
      callsign: "BTK6526",
      icao24: "8a0515",
    },
    createdAt: new Date("2026-07-27T10:30:00.000Z"),
    updatedAt: new Date("2026-07-27T10:30:00.000Z"),
    ...overrides,
  }) as Alert;

describe("Alert Export Service", () => {
  describe("calculateAlertSummary", () => {
    it("should return zeros for empty list", () => {
      const summary = calculateAlertSummary([]);
      expect(summary).toEqual({
        totalAlerts: 0,
        runwayIncursion: 0,
        shortTerm: 0,
        deviation: 0,
        areaPenetration: 0,
        taxiwayAlert: 0,
      });
    });

    it("should correctly aggregate all alert types", () => {
      const alerts: Alert[] = [
        mockAlert({ alertId: "a1", type: "RUNWAY_INCURSION" }),
        mockAlert({ alertId: "a2", type: "RUNWAY_INCURSION" }),
        mockAlert({ alertId: "a3", type: "STCA" }),
        mockAlert({ alertId: "a4", type: "SHORT_TERM" }),
        mockAlert({ alertId: "a5", type: "DEVIATION" }),
        mockAlert({ alertId: "a6", type: "AREA_PENETRATION" }),
        mockAlert({ alertId: "a7", type: "TAXIWAY_APRON_INCURSION" }),
        mockAlert({ alertId: "a8", type: "TAXIWAY_ALERT" }),
      ];

      const summary = calculateAlertSummary(alerts);
      expect(summary.totalAlerts).toBe(8);
      expect(summary.runwayIncursion).toBe(2);
      expect(summary.shortTerm).toBe(2);
      expect(summary.deviation).toBe(1);
      expect(summary.areaPenetration).toBe(1);
      expect(summary.taxiwayAlert).toBe(2);
    });
  });

  describe("formatExportFilename", () => {
    it("should format filename with YYYYMMDD dates", () => {
      const start = new Date("2026-07-27T00:00:00.000Z");
      const end = new Date("2026-07-28T23:59:59.000Z");

      expect(formatExportFilename(start, end, "csv")).toBe(
        "alerts_20260727_20260728.csv",
      );
      expect(formatExportFilename(start, end, "xlsx")).toBe(
        "alerts_20260727_20260728.xlsx",
      );
    });
  });

  describe("generateCsvExport", () => {
    it("should generate CSV with header and data rows", () => {
      const alerts: Alert[] = [
        mockAlert({
          alertId: "alert_001",
          type: "RUNWAY_INCURSION",
          trackId: "track_001",
          airportId: "WARR",
          status: "ACTIVE",
          severity: "HIGH",
          data: { callsign: "BTK6526", icao24: "8a0515" },
        }),
        mockAlert({
          alertId: "alert_002",
          type: "STCA",
          trackId: "track_002",
          airportId: "WARR",
          status: "CLEARED",
          severity: "MEDIUM",
          data: {}, // no callsign or icao24
        }),
      ];

      const csv = generateCsvExport(alerts);
      const lines = csv.split("\r\n");

      expect(lines[0]).toBe(
        "Alert ID,Alert Type,Aircraft / Track ID,Callsign,ICAO24,Airport,Detected At,Status,Severity",
      );
      expect(lines[1]).toContain(
        "alert_001,RUNWAY_INCURSION,track_001,BTK6526,8a0515,WARR",
      );
      expect(lines[2]).toContain("alert_002,STCA,track_002,,,WARR");
    });

    it("should properly escape special CSV characters", () => {
      const alerts: Alert[] = [
        mockAlert({
          alertId: 'alert,"special"',
          data: { callsign: "CALL,SIGN" },
        }),
      ];

      const csv = generateCsvExport(alerts);
      expect(csv).toContain('"alert,""special"""');
      expect(csv).toContain('"CALL,SIGN"');
    });
  });

  describe("generateExcelExport", () => {
    it("should create an Excel workbook with Alerts and Summary sheets", async () => {
      const alerts: Alert[] = [
        mockAlert({
          alertId: "alert_001",
          type: "RUNWAY_INCURSION",
          trackId: "track_001",
          data: { callsign: "BTK6526", icao24: "8a0515" },
        }),
      ];
      const summary: AlertExportSummary = {
        totalAlerts: 1,
        runwayIncursion: 1,
        shortTerm: 0,
        deviation: 0,
        areaPenetration: 0,
        taxiwayAlert: 0,
      };

      const buffer = await generateExcelExport(alerts, summary);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);

      // Verify readable back by ExcelJs
      const workbook = new ExcelJs.Workbook();
      await workbook.xlsx.load(buffer as unknown as ExcelJs.Buffer);

      const alertsSheet = workbook.getWorksheet("Alerts");
      expect(alertsSheet).toBeDefined();
      expect(alertsSheet?.rowCount).toBe(2); // 1 header + 1 data row

      const summarySheet = workbook.getWorksheet("Summary");
      expect(summarySheet).toBeDefined();
      expect(summarySheet?.rowCount).toBe(7); // 1 header + 6 summary rows
    });
  });
});
