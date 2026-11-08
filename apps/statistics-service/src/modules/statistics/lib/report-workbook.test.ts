import { describe, expect, it } from "bun:test";
import ExcelJS from "exceljs";
import { sampleReportResult } from "./report-fixture";
import {
  formatDateShort,
  parseDateOnly,
  trendLabel,
  wallClockDate,
} from "./report-format";
import { buildOperationalReport } from "./report-workbook";

const options = {
  airportId: "WARR",
  generatedAt: new Date("2026-11-02T07:05:00Z"),
};

/** Tulis lalu baca ulang, supaya yang diuji adalah berkas yang sungguh dihasilkan. */
async function roundTrip(
  result = sampleReportResult(),
  severity?: string,
): Promise<ExcelJS.Workbook> {
  const wb = buildOperationalReport(result, { ...options, severity });
  const buffer = await wb.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook();
  await read.xlsx.load(buffer);
  return read;
}

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`sheet ${name} not found`);
  return ws;
}

const text = (ws: ExcelJS.Worksheet, address: string): string =>
  String(ws.getCell(address).value ?? "");

describe("buildOperationalReport", () => {
  it("creates the seven sheets in reading order", async () => {
    const wb = await roundTrip();
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Ringkasan Eksekutif",
      "Tren Aktivitas",
      "Lalu Lintas Darat",
      "Ringkasan Alert",
      "Log Alert",
      "Log Pergerakan",
      "Legenda & Catatan",
    ]);
  });

  it("titles the summary with airport, period and generated time in WIB", async () => {
    const ws = sheet(await roundTrip(), "Ringkasan Eksekutif");
    expect(text(ws, "B2")).toBe("LAPORAN STATISTIK AKTIVITAS BANDARA");
    const subtitle = text(ws, "B3");
    expect(subtitle).toContain("Juanda International Airport (WARR)");
    expect(subtitle).toContain("Harian");
    expect(subtitle).toContain("01 November 2026 s.d. 02 November 2026");
    expect(text(ws, "B4")).toContain("14:05 WIB");
  });

  it("fills the summary cards from the statistics, with Total as a formula", async () => {
    const ws = sheet(await roundTrip(), "Ringkasan Eksekutif");
    expect(ws.getCell("C8").value).toBe(3); // landing
    expect(ws.getCell("D8").value).toBe(5); // takeoff
    expect(ws.getCell("B8").value).toEqual({ formula: "C8+D8", result: 8 });
    expect(ws.getCell("E8").value).toBe(3); // peak
    expect(text(ws, "E9")).toContain("01 Nov 2026 pukul 09:00");
    expect(ws.getCell("B18").value).toBe(3); // total alert
    expect(text(ws, "E18")).toBe("Short Term Conflict (STCA)");
  });

  it("states honestly that ground vehicle data does not exist yet", async () => {
    const ws = sheet(await roundTrip(), "Ringkasan Eksekutif");
    expect(text(ws, "D14")).toBe("belum ada sumber data");
    const highlights: string[] = [];
    ws.eachRow((row) => {
      const v = row.getCell(2).value;
      if (typeof v === "string" && v.startsWith("•")) highlights.push(v);
    });
    expect(
      highlights.some((h) => h.includes("kendaraan darat belum tersedia")),
    ).toBe(true);
  });

  it("lists one trend row per bucket with SUM totals and percent formulas", async () => {
    const ws = sheet(await roundTrip(), "Tren Aktivitas");
    expect(text(ws, "B6")).toBe("01 Nov 2026");
    expect(ws.getCell("C6").value).toBe(2); // landing
    expect(ws.getCell("D6").value).toBe(3); // takeoff
    expect(ws.getCell("E6").value).toEqual({ formula: "C6+D6", result: 5 });
    expect(text(ws, "B8")).toBe("TOTAL");
    expect(ws.getCell("E8").value).toEqual({
      formula: "SUM(E6:E7)",
      result: 8,
    });
    const pctCell = ws.getCell("F6").value as {
      formula: string;
      result: number;
    };
    expect(pctCell.formula).toBe("IF($E$8=0,0,E6/$E$8)");
    expect(pctCell.result).toBeCloseTo(5 / 8, 5);
  });

  it("reconciles trend totals with the system summary", async () => {
    const ws = sheet(await roundTrip(), "Tren Aktivitas");
    // Landing 3 = 2 + 1 and Takeoff 5 = 3 + 2 in the fixture, so both differences are 0.
    // A cached result of 0 is not kept on read-back, so only the formula is compared.
    expect(ws.getCell("E12").value).toMatchObject({ formula: "C12-D12" });
    expect(ws.getCell("E13").value).toMatchObject({ formula: "C13-D13" });
  });

  it("adds a Rentang column for monthly periods only", async () => {
    const base = sampleReportResult().trend[0];
    if (!base) throw new Error("fixture has no trend");
    const monthly = sampleReportResult({
      period: "monthly",
      trend: [
        {
          ...base,
          period: "2026-11-01",
          periodRange: "2026-11-01 - 2026-11-30",
        },
      ],
    });
    const ws = sheet(await roundTrip(monthly), "Tren Aktivitas");
    expect(text(ws, "B5")).toBe("Bulan");
    expect(text(ws, "C5")).toBe("Rentang");
    expect(text(ws, "B6")).toBe("November 2026");
    expect(text(ws, "C6")).toBe("01 Nov 2026 – 30 Nov 2026");
    const daily = sheet(await roundTrip(), "Tren Aktivitas");
    expect(text(daily, "C5")).toBe("Landing");
  });

  it("splits alerts by category and severity and totals them with formulas", async () => {
    const ws = sheet(await roundTrip(), "Ringkasan Alert");
    expect(text(ws, "B6")).toBe("Runway Incursion");
    expect(ws.getCell("C6").value).toBe(1);
    expect(ws.getCell("F6").value).toBe(1); // warning
    expect(text(ws, "B7")).toBe("Short Term Conflict (STCA)");
    expect(ws.getCell("E7").value).toBe(2); // critical
    expect(text(ws, "B11")).toBe("TOTAL");
    expect(ws.getCell("C11").value).toEqual({
      formula: "SUM(C6:C10)",
      result: 3,
    });
  });

  it("ranks the callsigns with most alerts", async () => {
    const ws = sheet(await roundTrip(), "Ringkasan Alert");
    let count: unknown;
    ws.eachRow((row) => {
      if (String(row.getCell(2).value).startsWith("1. LNI878")) {
        count = row.getCell(3).value;
      }
    });
    expect(count).toBe(2);
  });

  it("writes the alert log newest first with WIB wall-clock times", async () => {
    const ws = sheet(await roundTrip(), "Log Alert");
    expect(text(ws, "B5")).toBe("No.");
    expect(ws.getCell("C6").value).toEqual(new Date("2026-11-02T05:10:00Z"));
    expect(text(ws, "D6")).toBe("Short Term Conflict (STCA)");
    expect(text(ws, "F6")).toBe("Critical");
    expect(text(ws, "E8")).toBe("—"); // alert without callsign
    expect(text(ws, "F8")).toBe("Warning");
  });

  it("writes the verification of each alert next to its description, with the history one step per line", async () => {
    const ws = sheet(await roundTrip(), "Log Alert");
    expect(text(ws, "H5")).toBe("Status Verifikasi");
    expect(text(ws, "L5")).toBe("Riwayat Verifikasi");
    // newest first: the 2026-11-02 05:10 STCA is the verified one
    expect(text(ws, "H6")).toBe("Valid alert");
    expect(text(ws, "I6")).toBe("Budi");
    expect(text(ws, "K6")).toBe("Dikonfirmasi tower");
    const history = text(ws, "L6").split(String.fromCharCode(10));
    expect(history).toHaveLength(2);
    expect(history[0]).toContain("Sari");
    expect(history[0]).toContain("Belum diverifikasi → False alert");
    expect(history[1]).toContain("False alert → Valid alert");
    // an alert nobody has looked at
    expect(text(ws, "H7")).toBe("Belum diverifikasi");
    expect(text(ws, "I7")).toBe("—");
    expect(text(ws, "L7")).toBe("—");
  });

  it("writes the movement log with one row per aircraft, hour and type", async () => {
    const ws = sheet(await roundTrip(), "Log Pergerakan");
    const types: string[] = [];
    ws.eachRow((row, n) => {
      if (n >= 6) types.push(String(row.getCell(6).value));
    });
    expect(types.length).toBe(5);
    expect(types.filter((t) => t === "Takeoff").length).toBe(3);
    expect(types.filter((t) => t === "Landing").length).toBe(2);
    // A landing without a timestamp sorts last and shows a dash.
    expect(text(ws, "D10")).toBe("—");
  });

  it("documents the filter and the colour code in the legend", async () => {
    const wb = await roundTrip(sampleReportResult(), "CRITICAL");
    const ws = sheet(wb, "Legenda & Catatan");
    const cells: string[] = [];
    ws.eachRow((row) => {
      cells.push(String(row.getCell(2).value), String(row.getCell(3).value));
    });
    expect(cells).toContain("Filter keparahan alert");
    expect(cells).toContain("Critical");
    expect(cells).toContain("Teks biru");
    expect(cells).toContain("Teks hitam");
  });

  it("copes with a period that has no data at all", async () => {
    const empty = sampleReportResult({
      traffic: {
        totalAircraft: 0,
        totalGroundVehicle: 0,
        totalTraffic: 0,
        averageTrafficPerHour: 0,
        peakTrafficMovement: 0,
        peakTrafficHour: null,
      },
      movement: {
        totalTakeoff: 0,
        totalLanding: 0,
        averageMovementPerHour: 0,
        peakHourMovement: 0,
        peakHour: null,
      },
      alerts: {
        stca: { count: 0, details: [] },
        apa: { count: 0, details: [] },
        da: { count: 0, details: [] },
        ria: { count: 0, details: [] },
        taia: { count: 0, details: [] },
        total: 0,
        incidents: {
          total: 0,
          byCategory: { stca: 0, apa: 0, da: 0, ria: 0, taia: 0 },
          needsAction: 0,
        },
      },
      trend: [],
    });
    const wb = await roundTrip(empty);
    expect(sheet(wb, "Tren Aktivitas").getCell("E6").value).toMatchObject({
      formula: "0",
    });
    expect(text(sheet(wb, "Ringkasan Eksekutif"), "E18")).toBe("—");
    expect(text(sheet(wb, "Log Alert"), "C6")).toBe(
      "Tidak ada alert pada periode ini.",
    );
  });
});

describe("report-format", () => {
  it("formats Indonesian dates", () => {
    expect(formatDateShort("2026-05-30")).toBe("30 Mei 2026");
    expect(formatDateShort("not a date")).toBe("not a date");
    expect(parseDateOnly("2026-13-01")).toBeNull();
  });

  it("labels trend rows by period type", () => {
    expect(trendLabel("hourly", { period: "2026-11-01T09:00" })).toBe(
      "01 Nov 2026 09:00",
    );
    expect(
      trendLabel("weekly", {
        period: "2026-10-26",
        periodRange: "2026-10-26 - 2026-11-01",
      }),
    ).toBe("26 Okt 2026 – 01 Nov 2026");
  });

  it("keeps WIB wall-clock time as it is", () => {
    expect(wallClockDate("2026-11-02T05:10:00+07:00")?.toISOString()).toBe(
      "2026-11-02T05:10:00.000Z",
    );
    expect(wallClockDate(null)).toBeNull();
    expect(wallClockDate("nope")).toBeNull();
  });
});
