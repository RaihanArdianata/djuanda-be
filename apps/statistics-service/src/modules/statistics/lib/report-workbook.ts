import ExcelJs from "exceljs";
import type { OperationalStatisticsResult } from "../service/statistics.service";
import { type AlertDetail, formatAlertDate } from "./alert-detail";
import {
  airportTitle,
  formatDateLong,
  formatDateShort,
  formatGeneratedAt,
  PERIOD_COLUMN_LABEL,
  PERIOD_LABEL,
  PERIOD_UNIT,
  SEVERITY_LABEL,
  trendLabel,
  trendRangeLabel,
  wallClockDate,
} from "./report-format";
import {
  allAlertDetails,
  deriveReportStats,
  type RankedItem,
  type ReportStats,
} from "./report-stats";
import {
  BORDER,
  type BodyCell,
  COLOR,
  colLetter,
  configureSheet,
  dataBarRule,
  FMT,
  FONT_NAME,
  fill,
  setWidths,
  wrappedHeight,
  writeBodyRow,
  writeHeaderRow,
  writeNote,
  writeSectionTitle,
  writeTitleBlock,
  writeTotalRow,
} from "./report-style";

export interface ReportOptions {
  airportId: string;
  /** Saat laporan dibuat; dipakai di judul dan sheet Legenda. */
  generatedAt: Date;
  /** Filter keparahan alert yang dipakai (kosong = semua). */
  severity?: string;
}

const SHEET = {
  summary: "Ringkasan Eksekutif",
  trend: "Tren Aktivitas",
  traffic: "Lalu Lintas Darat",
  alerts: "Ringkasan Alert",
  alertLog: "Log Alert",
  movementLog: "Log Pergerakan",
  legend: "Legenda & Catatan",
} as const;

const TAB = {
  summary: "FF1F2A44",
  trend: "FF2E75B6",
  traffic: "FF548235",
  alerts: "FFC0392B",
  log: "FF7F7F7F",
  legend: "FFBF9000",
} as const;

const DASH = "—";

interface Context {
  result: OperationalStatisticsResult;
  stats: ReportStats;
  options: ReportOptions;
  /** "Harian", "Bulanan", dan seterusnya. */
  periodName: string;
}

function severityText(severity: string | undefined): string {
  if (!severity) return "Semua tingkat keparahan";
  const upper = severity.trim().toUpperCase();
  return SEVERITY_LABEL[upper] ?? severity;
}

function rangeText(result: OperationalStatisticsResult): string {
  const base = `${formatDateLong(result.startDate)} s.d. ${formatDateLong(result.endDate)}`;
  return result.startTime && result.endTime
    ? `${base}, pukul ${result.startTime}-${result.endTime} WIB`
    : base;
}

function subtitle(ctx: Context): string {
  return `${airportTitle(ctx.options.airportId)}  |  Periode ${ctx.periodName}: ${rangeText(ctx.result)}`;
}

const pct = (part: number, whole: number): number =>
  whole > 0 ? part / whole : 0;

/** "2026-08-01T09:00" -> "01 Agu 2026 pukul 09:00"; nilai lain apa adanya. */
function peakWhen(value: string | null): string {
  if (!value) return DASH;
  return /T\d{2}:\d{2}/.test(value)
    ? `${formatDateShort(value)} pukul ${/T(\d{2}:\d{2})/.exec(value)?.[1]}`
    : value;
}

// ---------------------------------------------------------------------------
// Sheet 1 - Ringkasan Eksekutif
// ---------------------------------------------------------------------------

interface Card {
  label: string;
  value: ExcelJs.CellValue;
  unit: string;
  fmt?: string;
  input?: boolean;
}

function writeCards(ws: ExcelJs.Worksheet, row: number, cards: Card[]): void {
  cards.forEach((card, i) => {
    const col = 2 + i;
    const bg = i % 2 === 0 ? COLOR.cardA : COLOR.cardB;

    const label = ws.getCell(row, col);
    label.value = card.label;
    label.font = {
      name: FONT_NAME,
      size: 10,
      color: { argb: COLOR.subtitle },
    };

    const value = ws.getCell(row + 1, col);
    value.value = card.value;
    value.font = {
      name: FONT_NAME,
      size: 14,
      bold: true,
      color: { argb: card.input ? COLOR.input : COLOR.text },
    };
    if (card.fmt) value.numFmt = card.fmt;

    const unit = ws.getCell(row + 2, col);
    unit.value = card.unit;
    unit.font = { name: FONT_NAME, size: 8, color: { argb: COLOR.note } };

    for (const cell of [label, value, unit]) {
      cell.fill = fill(bg);
      cell.border = BORDER;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    }
  });
  ws.getRow(row + 1).height = 24;
  ws.getRow(row + 2).height = 24;
}

function highlights(ctx: Context): string[] {
  const { result, stats } = ctx;
  const lines: string[] = [];
  const total = stats.totalMovement;

  if (total === 0) {
    lines.push(
      "Tidak ada pergerakan takeoff maupun landing yang tercatat pada periode ini.",
    );
  } else {
    const takeoffShare = Math.round(
      pct(result.movement.totalTakeoff, total) * 100,
    );
    lines.push(
      `Total ${total.toLocaleString("id-ID")} pergerakan: ${result.movement.totalTakeoff.toLocaleString("id-ID")} takeoff (${takeoffShare}%) dan ${result.movement.totalLanding.toLocaleString("id-ID")} landing (${100 - takeoffShare}%).`,
    );
    if (stats.peakMovement) {
      const p = stats.peakMovement;
      lines.push(
        `Periode tersibuk: ${trendLabel(result.period, p)} dengan ${p.totalMovement.toLocaleString("id-ID")} pergerakan (${Math.round(pct(p.totalMovement, total) * 100)}% dari total).`,
      );
    }
    if (result.movement.peakHour) {
      lines.push(
        `Jam puncak: ${peakWhen(result.movement.peakHour)} dengan ${result.movement.peakHourMovement.toLocaleString("id-ID")} pergerakan; rata-rata ${result.movement.averageMovementPerHour.toLocaleString("id-ID")} pergerakan per jam.`,
      );
    }
  }

  if (result.alerts.total === 0) {
    lines.push("Tidak ada alert pada periode ini.");
  } else {
    const d = stats.dominantCategory;
    lines.push(
      `Total ${result.alerts.total.toLocaleString("id-ID")} alert${result.alerts.incidents.total > 0 ? `, setara ${result.alerts.incidents.total.toLocaleString("id-ID")} kejadian setelah alert yang sama digabung (${result.alerts.incidents.needsAction.toLocaleString("id-ID")} kejadian belum selesai dinilai)` : ""} (${stats.alertCritical.toLocaleString("id-ID")} Critical, ${stats.alertWarning.toLocaleString("id-ID")} Warning).${d ? ` Kategori dominan: ${d.label} sebanyak ${d.count.toLocaleString("id-ID")} (${Math.round(pct(d.count, result.alerts.total) * 100)}%).` : ""}`,
    );
    if (stats.peakAlert) {
      lines.push(
        `Alert terbanyak pada ${trendLabel(result.period, stats.peakAlert)} (${stats.peakAlert.alerts.toLocaleString("id-ID")} alert).`,
      );
    }
  }

  if (!stats.groundVehicleAvailable) {
    lines.push(
      "Data kendaraan darat belum tersedia: sistem belum memiliki sumber pergerakan kendaraan, sehingga nilainya 0 pada seluruh laporan.",
    );
  }
  return lines;
}

function buildSummarySheet(wb: ExcelJs.Workbook, ctx: Context): void {
  const { result, stats } = ctx;
  const ws = wb.addWorksheet(SHEET.summary);
  configureSheet(ws, { tab: TAB.summary });
  setWidths(ws, [22, 22, 22, 22, 22]);

  writeTitleBlock(
    ws,
    6,
    "LAPORAN STATISTIK AKTIVITAS BANDARA",
    subtitle(ctx),
    `Dibuat otomatis oleh A-SMGCS pada ${formatGeneratedAt(ctx.options.generatedAt)}. Rincian ada di sheet berikutnya; arti warna dan istilah di sheet Legenda & Catatan.`,
  );

  writeSectionTitle(ws, 6, "AKTIVITAS PESAWAT TERBANG");
  writeCards(ws, 7, [
    {
      label: "Total Aktivitas",
      value: {
        formula: "C8+D8",
        result: stats.totalMovement,
      },
      unit: "pergerakan",
      fmt: FMT.int,
    },
    {
      label: "Landing",
      value: result.movement.totalLanding,
      unit: "pergerakan",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Takeoff",
      value: result.movement.totalTakeoff,
      unit: "pergerakan",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Peak Aktivitas",
      value: result.movement.peakHourMovement,
      unit: result.movement.peakHour
        ? `pada ${peakWhen(result.movement.peakHour)}`
        : "tidak ada data",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Rata-rata / jam",
      value: result.movement.averageMovementPerHour,
      unit: "pergerakan per jam",
      fmt: FMT.decimal,
      input: true,
    },
  ]);

  writeSectionTitle(ws, 11, "AKTIVITAS LALU LINTAS BANDARA");
  writeCards(ws, 12, [
    {
      label: "Total Trafik",
      value: {
        formula: "C13+D13",
        result:
          result.traffic.totalAircraft + result.traffic.totalGroundVehicle,
      },
      unit: "objek unik",
      fmt: FMT.int,
    },
    {
      label: "Pesawat Terbang",
      value: result.traffic.totalAircraft,
      unit: "objek unik",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Kendaraan Darat",
      value: result.traffic.totalGroundVehicle,
      unit: stats.groundVehicleAvailable
        ? "objek unik"
        : "belum ada sumber data",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Peak Aktivitas",
      value: result.traffic.peakTrafficMovement,
      unit: result.traffic.peakTrafficHour
        ? `pada ${peakWhen(result.traffic.peakTrafficHour)}`
        : "tidak ada data",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Rata-rata / jam",
      value: result.traffic.averageTrafficPerHour,
      unit: "objek per jam",
      fmt: FMT.decimal,
      input: true,
    },
  ]);

  const dominant = stats.dominantCategory;
  writeSectionTitle(
    ws,
    16,
    `RINGKASAN ALERT (${formatDateShort(result.startDate).toUpperCase()} - ${formatDateShort(result.endDate).toUpperCase()})`,
  );
  writeCards(ws, 17, [
    {
      label: "Total Alert",
      value: result.alerts.total,
      unit: "alert",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Critical",
      value: stats.alertCritical,
      unit: "alert",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Warning",
      value: stats.alertWarning,
      unit: "alert",
      fmt: FMT.int,
      input: true,
    },
    {
      label: "Kategori Dominan",
      value: dominant ? dominant.label : DASH,
      unit: dominant
        ? `${dominant.count.toLocaleString("id-ID")} alert`
        : "tidak ada alert",
    },
    {
      label: "% dari Total",
      value: dominant ? pct(dominant.count, result.alerts.total) : 0,
      unit: "kategori dominan",
      fmt: FMT.percent,
    },
  ]);

  writeSectionTitle(ws, 21, "SOROTAN");
  highlights(ctx).forEach((line, i) => {
    const row = 22 + i;
    ws.mergeCells(row, 2, row, 6);
    const cell = ws.getCell(row, 2);
    cell.value = `•  ${line}`;
    cell.font = { name: FONT_NAME, size: 10, color: { argb: COLOR.text } };
    cell.alignment = { vertical: "top", wrapText: true };
    ws.getRow(row).height = wrappedHeight(`•  ${line}`, 118);
  });
}

// ---------------------------------------------------------------------------
// Sheet 2 - Tren Aktivitas
// ---------------------------------------------------------------------------

function buildTrendSheet(wb: ExcelJs.Workbook, ctx: Context): void {
  const { result } = ctx;
  const ws = wb.addWorksheet(SHEET.trend);
  const hasRange = result.period === "monthly";
  const headers = [
    PERIOD_COLUMN_LABEL[result.period],
    ...(hasRange ? ["Rentang"] : []),
    "Landing",
    "Takeoff",
    "Total",
    "% dari Total",
    "Pesawat Unik",
    "Alert",
  ];
  const widths = [
    hasRange ? 18 : 28,
    ...(hasRange ? [28] : []),
    14,
    14,
    14,
    18,
    16,
    12,
  ];
  configureSheet(ws, { tab: TAB.trend, freezeRow: 5, printTitleRow: 5 });
  setWidths(ws, widths);

  const first = 2;
  const last = first + headers.length - 1;
  const col = (name: string): number => first + headers.indexOf(name);
  const L = (name: string): string => colLetter(col(name));

  writeTitleBlock(
    ws,
    last,
    `AKTIVITAS PESAWAT PER ${PERIOD_UNIT[result.period]}`,
    subtitle(ctx),
    "Landing dan Takeoff dari catatan pergerakan sistem; Total dan persentase dihitung dengan rumus.",
  );
  writeHeaderRow(ws, 5, headers);

  const dataStart = 6;
  const dataEnd = dataStart + result.trend.length - 1;
  const totalRow = dataEnd + 1;
  const totalRef = `$${L("Total")}$${totalRow}`;
  const totalMovement = ctx.stats.totalMovement;

  result.trend.forEach((point, i) => {
    const row = dataStart + i;
    const cells: BodyCell[] = [
      { value: trendLabel(result.period, point) },
      ...(hasRange
        ? [{ value: trendRangeLabel(result.period, point) } as BodyCell]
        : []),
      { value: point.landing, kind: "input", fmt: FMT.int },
      { value: point.takeoff, kind: "input", fmt: FMT.int },
      {
        value: {
          formula: `${L("Landing")}${row}+${L("Takeoff")}${row}`,
          result: point.landing + point.takeoff,
        },
        kind: "calc",
        fmt: FMT.int,
      },
      {
        value: {
          formula: `IF(${totalRef}=0,0,${L("Total")}${row}/${totalRef})`,
          result: pct(point.landing + point.takeoff, totalMovement),
        },
        kind: "calc",
        fmt: FMT.percent,
      },
      { value: point.aircraft, kind: "input", fmt: FMT.int },
      { value: point.alerts, kind: "input", fmt: FMT.int },
    ];
    writeBodyRow(ws, row, cells, i % 2 === 1);
  });

  // Tanpa baris tren, rentang SUM akan menunjuk ke baris total sendiri (sirkular): pakai 0.
  const sum = (name: string): { formula: string; result?: number } => ({
    formula:
      result.trend.length === 0
        ? "0"
        : `SUM(${L(name)}${dataStart}:${L(name)}${dataEnd})`,
  });
  const sumOf = (pick: (p: (typeof result.trend)[number]) => number): number =>
    result.trend.reduce((acc, p) => acc + pick(p), 0);
  const totals: BodyCell[] = [
    { value: "TOTAL" },
    ...(hasRange ? [{ value: "" } as BodyCell] : []),
    {
      value: { ...sum("Landing"), result: sumOf((p) => p.landing) },
      fmt: FMT.int,
    },
    {
      value: { ...sum("Takeoff"), result: sumOf((p) => p.takeoff) },
      fmt: FMT.int,
    },
    {
      value: { ...sum("Total"), result: sumOf((p) => p.landing + p.takeoff) },
      fmt: FMT.int,
    },
    {
      value: {
        formula: `IF(${totalRef}=0,0,${L("Total")}${totalRow}/${totalRef})`,
        result: totalMovement > 0 ? 1 : 0,
      },
      fmt: FMT.percent,
    },
    {
      // Objek unik tidak bisa dijumlah per periode; yang tampil adalah total unik dari sistem.
      value: ctx.result.traffic.totalAircraft,
      fmt: FMT.int,
    },
    {
      value: { ...sum("Alert"), result: sumOf((p) => p.alerts) },
      fmt: FMT.int,
    },
  ];
  writeTotalRow(ws, totalRow, totals);

  if (result.trend.length > 0) {
    ws.addConditionalFormatting({
      ref: `${L("Total")}${dataStart}:${L("Total")}${dataEnd}`,
      rules: [dataBarRule()],
    });
    ws.autoFilter = {
      from: { row: 5, column: first },
      to: { row: dataEnd, column: last },
    };
  }

  // Rekonsiliasi: total tren harus sama dengan ringkasan dari sistem.
  const reconRow = totalRow + 2;
  writeSectionTitle(ws, reconRow, "REKONSILIASI DENGAN RINGKASAN SISTEM");
  writeHeaderRow(
    ws,
    reconRow + 1,
    ["Komponen", "Ringkasan", "Total Tren", "Selisih"],
    first,
  );
  const recon = (
    row: number,
    label: string,
    summary: number,
    column: string,
    trendTotal: number,
  ): void => {
    writeBodyRow(
      ws,
      row,
      [
        { value: label },
        { value: summary, kind: "input", fmt: FMT.int },
        {
          value: { formula: `${L(column)}${totalRow}`, result: trendTotal },
          kind: "calc",
          fmt: FMT.int,
        },
        {
          value: {
            formula: `${colLetter(first + 1)}${row}-${colLetter(first + 2)}${row}`,
            result: summary - trendTotal,
          },
          kind: "calc",
          fmt: FMT.int,
        },
      ],
      false,
      first,
    );
  };
  recon(
    reconRow + 2,
    "Landing",
    result.movement.totalLanding,
    "Landing",
    sumOf((p) => p.landing),
  );
  recon(
    reconRow + 3,
    "Takeoff",
    result.movement.totalTakeoff,
    "Takeoff",
    sumOf((p) => p.takeoff),
  );
  writeNote(
    ws,
    reconRow + 5,
    last,
    "Selisih 0 berarti angka ringkasan dan rincian per periode konsisten. Selisih lain umumnya muncul bila pergerakan terjadi di luar jam yang dipilih.",
    90,
  );
}

// ---------------------------------------------------------------------------
// Sheet 3 - Lalu Lintas Darat
// ---------------------------------------------------------------------------

function writeRanking(
  ws: ExcelJs.Worksheet,
  row: number,
  items: RankedItem[],
  labels: [string, string],
  emptyText: string,
): number {
  writeHeaderRow(ws, row, labels);
  if (items.length === 0) {
    writeBodyRow(ws, row + 1, [{ value: emptyText }, { value: "" }], false);
    return row + 2;
  }
  items.forEach((item, i) => {
    writeBodyRow(
      ws,
      row + 1 + i,
      [
        { value: `${i + 1}. ${item.name}` },
        { value: item.count, kind: "input", fmt: FMT.int },
      ],
      i % 2 === 1,
    );
  });
  return row + 1 + items.length;
}

function buildTrafficSheet(wb: ExcelJs.Workbook, ctx: Context): void {
  const { result, stats } = ctx;
  const ws = wb.addWorksheet(SHEET.traffic);
  configureSheet(ws, { tab: TAB.traffic });
  setWidths(ws, [34, 18, 18, 18, 24]);

  writeTitleBlock(
    ws,
    6,
    `AKTIVITAS LALU LINTAS BANDARA (DARAT) - ${ctx.periodName.toUpperCase()}`,
    subtitle(ctx),
    "Objek unik (pesawat dan kendaraan) yang tercatat bergerak di bandara pada periode ini.",
  );

  writeSectionTitle(ws, 5, "RINGKASAN");
  writeHeaderRow(ws, 6, ["Metrik", "Nilai", "Keterangan"]);
  ws.mergeCells(6, 4, 6, 6);

  const t = result.traffic;
  const rows: Array<[string, BodyCell, string]> = [
    [
      "Pesawat Terbang",
      { value: t.totalAircraft, kind: "input", fmt: FMT.int },
      "objek unik",
    ],
    [
      "Kendaraan Darat",
      { value: t.totalGroundVehicle, kind: "input", fmt: FMT.int },
      stats.groundVehicleAvailable
        ? "objek unik"
        : "belum ada sumber data kendaraan darat",
    ],
    [
      "Total Trafik",
      {
        value: {
          formula: "C7+C8",
          result: t.totalAircraft + t.totalGroundVehicle,
        },
        kind: "calc",
        fmt: FMT.int,
      },
      "pesawat + kendaraan",
    ],
    [
      "% Pesawat dari Total Trafik",
      {
        value: {
          formula: "IF(C9=0,0,C7/C9)",
          result: pct(t.totalAircraft, t.totalAircraft + t.totalGroundVehicle),
        },
        kind: "calc",
        fmt: FMT.percent,
      },
      "",
    ],
    [
      "Rata-rata per Jam",
      { value: t.averageTrafficPerHour, kind: "input", fmt: FMT.decimal },
      "objek per jam",
    ],
    [
      "Peak Aktivitas",
      { value: t.peakTrafficMovement, kind: "input", fmt: FMT.int },
      "pergerakan pada jam tersibuk",
    ],
    ["Jam Puncak", { value: peakWhen(t.peakTrafficHour) }, ""],
  ];
  rows.forEach(([label, valueCell, remark], i) => {
    const row = 7 + i;
    writeBodyRow(
      ws,
      row,
      [{ value: label }, valueCell, { value: remark, wrap: true }],
      i % 2 === 1,
    );
    ws.mergeCells(row, 4, row, 6);
  });

  let next = 7 + rows.length + 1;
  writeSectionTitle(ws, next, "10 CALLSIGN PALING AKTIF");
  next = writeRanking(
    ws,
    next + 1,
    stats.topAircraft,
    ["Callsign / Identitas", "Jumlah Pergerakan"],
    "Belum ada pergerakan pada periode ini.",
  );

  next += 1;
  writeSectionTitle(ws, next, `RINCIAN PER ${PERIOD_UNIT[result.period]}`);
  const headerRow = next + 1;
  writeHeaderRow(ws, headerRow, [
    PERIOD_COLUMN_LABEL[result.period],
    "Pesawat Unik",
    "Kendaraan Darat",
    "Total Trafik",
    "% Pesawat",
  ]);
  result.trend.forEach((point, i) => {
    const row = headerRow + 1 + i;
    const total = point.aircraft + point.groundVehicle;
    writeBodyRow(
      ws,
      row,
      [
        { value: trendLabel(result.period, point) },
        { value: point.aircraft, kind: "input", fmt: FMT.int },
        { value: point.groundVehicle, kind: "input", fmt: FMT.int },
        {
          value: { formula: `C${row}+D${row}`, result: total },
          kind: "calc",
          fmt: FMT.int,
        },
        {
          value: {
            formula: `IF(E${row}=0,0,C${row}/E${row})`,
            result: pct(point.aircraft, total),
          },
          kind: "calc",
          fmt: FMT.percent,
        },
      ],
      i % 2 === 1,
    );
  });
  writeNote(
    ws,
    headerRow + result.trend.length + 2,
    6,
    "Pesawat Unik per periode tidak dapat dijumlahkan ke total: satu pesawat yang bergerak di beberapa periode dihitung sekali per periode, tetapi hanya sekali pada ringkasan.",
    100,
  );
}

// ---------------------------------------------------------------------------
// Sheet 4 - Ringkasan Alert
// ---------------------------------------------------------------------------

function buildAlertSummarySheet(wb: ExcelJs.Workbook, ctx: Context): void {
  const { result, stats } = ctx;
  const ws = wb.addWorksheet(SHEET.alerts);
  configureSheet(ws, { tab: TAB.alerts });
  setWidths(ws, [34, 14, 16, 14, 14]);

  const severityNote = severityText(ctx.options.severity);
  writeTitleBlock(
    ws,
    6,
    `RINGKASAN ALERT - PERIODE ${formatDateShort(result.startDate).toUpperCase()} S.D. ${formatDateShort(result.endDate).toUpperCase()}`,
    subtitle(ctx),
    `Filter keparahan: ${severityNote}. Critical dan Warning dihitung dari rincian alert yang tercatat.`,
  );

  writeHeaderRow(ws, 5, [
    "Kategori",
    "Jumlah",
    "% dari Total",
    "Critical",
    "Warning",
  ]);
  const dataStart = 6;
  const dataEnd = dataStart + stats.categories.length - 1;
  const totalRow = dataEnd + 1;
  const totalRef = `$C$${totalRow}`;

  stats.categories.forEach((c, i) => {
    const row = dataStart + i;
    writeBodyRow(
      ws,
      row,
      [
        { value: c.label },
        { value: c.count, kind: "input", fmt: FMT.int },
        {
          value: {
            formula: `IF(${totalRef}=0,0,C${row}/${totalRef})`,
            result: pct(c.count, result.alerts.total),
          },
          kind: "calc",
          fmt: FMT.percent,
        },
        { value: c.critical, kind: "input", fmt: FMT.int },
        { value: c.warning, kind: "input", fmt: FMT.int },
      ],
      i % 2 === 1,
    );
  });
  const sumCol = (letter: string, total: number): BodyCell => ({
    value: {
      formula: `SUM(${letter}${dataStart}:${letter}${dataEnd})`,
      result: total,
    },
    fmt: FMT.int,
  });
  writeTotalRow(ws, totalRow, [
    { value: "TOTAL" },
    sumCol(
      "C",
      stats.categories.reduce((s, c) => s + c.count, 0),
    ),
    {
      value: {
        formula: `IF(${totalRef}=0,0,C${totalRow}/${totalRef})`,
        result: result.alerts.total > 0 ? 1 : 0,
      },
      fmt: FMT.percent,
    },
    sumCol("E", stats.alertCritical),
    sumCol("F", stats.alertWarning),
  ]);

  ws.addConditionalFormatting({
    ref: `D${dataStart}:D${dataEnd}`,
    rules: [dataBarRule()],
  });

  let next = totalRow + 2;
  const dominant = stats.dominantCategory;
  writeNote(
    ws,
    next,
    6,
    dominant
      ? `${dominant.label} mendominasi dengan ${Math.round(pct(dominant.count, result.alerts.total) * 100)}% dari seluruh alert. Disarankan menelusuri penyebabnya bila persentasenya jauh di atas kategori lain.`
      : "Tidak ada alert pada periode ini.",
    90,
  );

  next += 2;
  writeSectionTitle(ws, next, "10 CALLSIGN DENGAN ALERT TERBANYAK");
  writeRanking(
    ws,
    next + 1,
    stats.topAlertCallsigns,
    ["Callsign", "Jumlah Alert"],
    "Tidak ada alert pada periode ini.",
  );
}

// ---------------------------------------------------------------------------
// Sheet 5 - Log Alert
// ---------------------------------------------------------------------------

const VERIFICATION_LABEL: Readonly<Record<string, string>> = {
  UNVERIFIED: "Belum diverifikasi",
  VERIFIED: "Terverifikasi",
  FALSE_ALARM: "Alarm palsu",
};

function verificationLabel(status: string): string {
  return VERIFICATION_LABEL[status.toUpperCase()] ?? status;
}

/** Satu baris per langkah, terlama dahulu: `2 November 2026 pukul 05:30:00 WIB · Sari · Belum diverifikasi → Alarm palsu — catatan`. */
export function verificationHistoryText(
  history: AlertDetail["verification"]["history"],
): string {
  if (history.length === 0) return DASH;
  return history
    .map((h) => {
      const when = h.at ? (formatAlertDate(h.at) ?? h.at) : DASH;
      const change = `${h.from ? verificationLabel(h.from) : DASH} → ${h.to ? verificationLabel(h.to) : DASH}`;
      const note = h.note ? ` — ${h.note}` : "";
      return `${when} · ${h.by ?? DASH} · ${change}${note}`;
    })
    .join(String.fromCharCode(10));
}

function buildAlertLogSheet(wb: ExcelJs.Workbook, ctx: Context): void {
  const { result } = ctx;
  const ws = wb.addWorksheet(SHEET.alertLog);
  configureSheet(ws, { tab: TAB.log, freezeRow: 5, printTitleRow: 5 });
  setWidths(ws, [7, 22, 28, 16, 12, 70, 18, 20, 22, 36, 60]);

  const rows = allAlertDetails(result.alerts);
  writeTitleBlock(
    ws,
    7,
    "LOG ALERT",
    subtitle(ctx),
    `${rows.length.toLocaleString("id-ID")} alert, terbaru di atas. Waktu dalam WIB. Gunakan filter pada judul kolom untuk menyaring.`,
  );
  writeHeaderRow(ws, 5, [
    "No.",
    "Waktu (WIB)",
    "Kategori",
    "Callsign",
    "Keparahan",
    "Keterangan",
    "Status Verifikasi",
    "Diverifikasi Oleh",
    "Waktu Verifikasi (WIB)",
    "Catatan Verifikasi",
    "Riwayat Verifikasi",
  ]);

  rows.forEach((d, i) => {
    const severity = d.severity.toUpperCase();
    const critical = severity === "CRITICAL";
    writeBodyRow(
      ws,
      6 + i,
      [
        { value: i + 1, align: "center" },
        {
          value: wallClockDate(d.time) ?? d.time,
          fmt: FMT.dateTime,
          align: "left",
        },
        { value: d.category },
        { value: d.callsign ?? DASH },
        {
          value: SEVERITY_LABEL[severity] ?? d.severity,
          align: "center",
          bold: true,
          fontArgb: critical ? COLOR.critical : COLOR.warning,
          fillArgb: critical ? COLOR.criticalSoft : COLOR.warningSoft,
        },
        { value: d.description, wrap: true },
        { value: verificationLabel(d.verification.status), align: "center" },
        { value: d.verification.by ?? DASH },
        d.verification.at
          ? {
              value: wallClockDate(d.verification.at) ?? d.verification.at,
              fmt: FMT.dateTime,
              align: "left",
            }
          : { value: DASH },
        { value: d.verification.note ?? DASH, wrap: true },
        { value: verificationHistoryText(d.verification.history), wrap: true },
      ],
      i % 2 === 1,
    );
  });

  if (rows.length === 0) {
    writeBodyRow(
      ws,
      6,
      [{ value: "" }, { value: "Tidak ada alert pada periode ini." }],
      false,
    );
  } else {
    ws.autoFilter = {
      from: { row: 5, column: 2 },
      to: { row: 5 + rows.length, column: 12 },
    };
  }
}

// ---------------------------------------------------------------------------
// Sheet 6 - Log Pergerakan
// ---------------------------------------------------------------------------

interface MovementLogRow {
  period: string;
  at: string | null;
  aircraft: string;
  type: "Takeoff" | "Landing";
  count: number;
}

function movementLogRows(
  result: OperationalStatisticsResult,
): MovementLogRow[] {
  const rows: MovementLogRow[] = [];
  for (const point of result.trend) {
    const period = trendLabel(result.period, point);
    for (const item of point.takeoffAircraft) {
      rows.push({
        period,
        at: item.at,
        aircraft: item.aircraft,
        type: "Takeoff",
        count: item.count,
      });
    }
    for (const item of point.landingAircraft) {
      rows.push({
        period,
        at: item.at,
        aircraft: item.aircraft,
        type: "Landing",
        count: item.count,
      });
    }
  }
  return rows.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

function buildMovementLogSheet(wb: ExcelJs.Workbook, ctx: Context): void {
  const { result } = ctx;
  const ws = wb.addWorksheet(SHEET.movementLog);
  configureSheet(ws, { tab: TAB.log, freezeRow: 5, printTitleRow: 5 });
  setWidths(ws, [7, 26, 22, 22, 12, 16]);

  const rows = movementLogRows(result);
  writeTitleBlock(
    ws,
    7,
    "LOG PERGERAKAN TAKEOFF & LANDING",
    subtitle(ctx),
    `${rows.length.toLocaleString("id-ID")} baris (satu baris per pesawat per jam dan jenis). Waktu dalam WIB, menunjukkan kejadian terakhir pada jam tersebut.`,
  );
  writeHeaderRow(ws, 5, [
    "No.",
    "Periode",
    "Waktu Terakhir (WIB)",
    "Callsign",
    "Jenis",
    "Jumlah Kejadian",
  ]);

  rows.forEach((r, i) => {
    const landing = r.type === "Landing";
    writeBodyRow(
      ws,
      6 + i,
      [
        { value: i + 1, align: "center" },
        { value: r.period },
        {
          value: wallClockDate(r.at) ?? DASH,
          fmt: FMT.dateTime,
          align: "left",
        },
        { value: r.aircraft },
        {
          value: r.type,
          align: "center",
          bold: true,
          fontArgb: landing ? COLOR.ok : COLOR.input,
        },
        { value: r.count, kind: "input", fmt: FMT.int },
      ],
      i % 2 === 1,
    );
  });

  if (rows.length === 0) {
    writeBodyRow(
      ws,
      6,
      [{ value: "" }, { value: "Tidak ada pergerakan pada periode ini." }],
      false,
    );
  } else {
    ws.autoFilter = {
      from: { row: 5, column: 2 },
      to: { row: 5 + rows.length, column: 7 },
    };
  }
}

// ---------------------------------------------------------------------------
// Sheet 7 - Legenda & Catatan
// ---------------------------------------------------------------------------

function buildLegendSheet(wb: ExcelJs.Workbook, ctx: Context): void {
  const { result } = ctx;
  const ws = wb.addWorksheet(SHEET.legend);
  configureSheet(ws, { tab: TAB.legend });
  setWidths(ws, [32, 90]);

  writeTitleBlock(ws, 3, "LEGENDA & CATATAN", subtitle(ctx));

  let row = 5;
  const section = (text: string): void => {
    writeSectionTitle(ws, row, text);
    row += 1;
  };
  const pair = (key: BodyCell, text: string, zebra = false): void => {
    writeBodyRow(ws, row, [key, { value: text, wrap: true }], zebra);
    ws.getRow(row).height = wrappedHeight(text, 95);
    row += 1;
  };

  section("PARAMETER LAPORAN");
  const parameters: Array<[string, string]> = [
    ["Bandara", airportTitle(ctx.options.airportId)],
    ["Jenis periode", ctx.periodName],
    [
      "Rentang tanggal",
      `${formatDateLong(result.startDate)} s.d. ${formatDateLong(result.endDate)}`,
    ],
    [
      "Rentang jam harian",
      result.startTime && result.endTime
        ? `${result.startTime} - ${result.endTime} WIB`
        : "Seluruh hari (00:00-23:59 WIB)",
    ],
    ["Filter keparahan alert", severityText(ctx.options.severity)],
    ["Dibuat pada", formatGeneratedAt(ctx.options.generatedAt)],
  ];
  parameters.forEach(([key, text], i) => {
    pair({ value: key, bold: true }, text, i % 2 === 1);
  });

  row += 1;
  section("KODE WARNA");
  pair(
    { value: "Teks biru", kind: "input" },
    "Angka masukan yang berasal langsung dari sistem. Jangan diubah bila ingin laporan tetap sesuai data.",
  );
  pair(
    { value: "Teks hitam", kind: "calc" },
    "Hasil rumus; dihitung otomatis dari sel lain dan ikut berubah bila sel sumbernya diubah.",
    true,
  );
  pair(
    {
      value: "Critical",
      fontArgb: COLOR.critical,
      fillArgb: COLOR.criticalSoft,
      bold: true,
    },
    "Alert berkeparahan tinggi yang perlu penanganan segera.",
  );
  pair(
    {
      value: "Warning",
      fontArgb: COLOR.warning,
      fillArgb: COLOR.warningSoft,
      bold: true,
    },
    "Alert peringatan.",
    true,
  );

  row += 1;
  section("ISTILAH");
  const terms: Array<[string, string]> = [
    [
      "Takeoff / Landing",
      "Satu kejadian lepas landas atau mendarat yang tercatat sistem pada periode itu.",
    ],
    ["Total Aktivitas", "Takeoff ditambah Landing."],
    [
      "Peak Aktivitas",
      "Jumlah pergerakan pada satu jam tersibuk dalam periode.",
    ],
    [
      "Rata-rata / jam",
      "Total pergerakan dibagi jumlah jam dalam rentang yang dipilih.",
    ],
    [
      "Pesawat Unik",
      "Jumlah pesawat berbeda (bukan jumlah kejadian) yang bergerak pada periode itu.",
    ],
    [
      "Kategori alert",
      "Runway Incursion, Short Term Conflict (STCA), Deviation, Area Penetration, dan Taxiway / Apron Incursion.",
    ],
  ];
  terms.forEach(([key, text], i) => {
    pair({ value: key, bold: true }, text, i % 2 === 1);
  });

  row += 1;
  section("SUMBER DAN CATATAN DATA");
  const notes = [
    "Pergerakan diambil dari catatan takeoff dan landing sistem A-SMGCS; alert dari tabel alert sistem. Zona waktu seluruh laporan adalah WIB (UTC+7).",
    "Data kendaraan darat belum tersedia karena sistem belum memiliki sumber pergerakan kendaraan; nilainya selalu 0 dan bukan berarti tidak ada kendaraan.",
    "Kolom waktu pada sheet Log ditulis sebagai jam dinding WIB tanpa informasi zona waktu.",
    "Sheet Tren Aktivitas memuat rekonsiliasi terhadap ringkasan sistem; selisih selain 0 perlu dicek.",
  ];
  notes.forEach((text, i) => {
    pair({ value: `Catatan ${i + 1}`, bold: true }, text, i % 2 === 1);
  });
}

// ---------------------------------------------------------------------------

/** Susun seluruh workbook laporan dari hasil statistik operasional. */
export function buildOperationalReport(
  result: OperationalStatisticsResult,
  options: ReportOptions,
): ExcelJs.Workbook {
  const wb = new ExcelJs.Workbook();
  wb.creator = "A-SMGCS";
  wb.title = "Laporan Statistik Bandara";
  wb.subject = `${airportTitle(options.airportId)} ${result.startDate} s.d. ${result.endDate}`;
  wb.created = options.generatedAt;
  wb.modified = options.generatedAt;

  const ctx: Context = {
    result,
    stats: deriveReportStats(result),
    options,
    periodName: PERIOD_LABEL[result.period],
  };

  buildSummarySheet(wb, ctx);
  buildTrendSheet(wb, ctx);
  buildTrafficSheet(wb, ctx);
  buildAlertSummarySheet(wb, ctx);
  buildAlertLogSheet(wb, ctx);
  buildMovementLogSheet(wb, ctx);
  buildLegendSheet(wb, ctx);

  return wb;
}
