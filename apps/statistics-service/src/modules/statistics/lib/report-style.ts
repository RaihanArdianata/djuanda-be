import type ExcelJs from "exceljs";

/** Warna dan gaya bersama untuk semua sheet laporan. */
export const COLOR = {
  navy: "FF1F2A44",
  white: "FFFFFFFF",
  cardA: "FFDCE6F1",
  cardB: "FFEAF1F8",
  zebra: "FFF2F2F2",
  border: "FFBFBFBF",
  input: "FF0000FF",
  text: "FF000000",
  subtitle: "FF595959",
  note: "FF808080",
  critical: "FFC0392B",
  criticalSoft: "FFFDEDEC",
  warning: "FF9A6700",
  warningSoft: "FFFFF4D6",
  info: "FF1F5FA8",
  infoSoft: "FFEAF1F8",
  ok: "FF1E7B34",
  okSoft: "FFEAF6EC",
  bar: "FF9DC3E6",
} as const;

export const FONT_NAME = "Arial";

const thin: Partial<ExcelJs.Border> = {
  style: "thin",
  color: { argb: COLOR.border },
};

export const BORDER: Partial<ExcelJs.Borders> = {
  top: thin,
  left: thin,
  bottom: thin,
  right: thin,
};

export const FMT = {
  int: "#,##0",
  decimal: "#,##0.00",
  percent: "0.0%",
  dateTime: "dd/mm/yyyy hh:mm:ss",
} as const;

export function fill(argb: string): ExcelJs.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** Nomor kolom (1 = A) menjadi huruf: 1 -> A, 27 -> AA. */
export function colLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Perkiraan tinggi baris (poin) untuk teks yang dibungkus pada lebar kolom tertentu. */
export function wrappedHeight(
  text: string,
  widthChars: number,
  lineHeight = 13,
): number {
  const lines = text
    .split("\n")
    .reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(line.length / widthChars)),
      0,
    );
  return Math.max(lineHeight + 2, lines * lineHeight + 3);
}

/** Atur lebar kolom: kolom A dan kolom terakhir sengaja sempit sebagai margin. */
export function setWidths(ws: ExcelJs.Worksheet, widths: number[]): void {
  const all = [3, ...widths, 3];
  all.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });
}

export interface SheetOptions {
  tab: string;
  /** Baris yang dibekukan (judul tabel di atasnya ikut terkunci). */
  freezeRow?: number;
  /** Baris judul tabel yang diulang di tiap halaman cetak. */
  printTitleRow?: number;
}

/** Pengaturan umum: tanpa garis kisi, tampilan cetak A4 mendatar, footer bernomor halaman. */
export function configureSheet(
  ws: ExcelJs.Worksheet,
  options: SheetOptions,
): void {
  ws.properties.tabColor = { argb: options.tab };
  ws.views = [
    {
      showGridLines: false,
      ...(options.freezeRow
        ? { state: "frozen" as const, xSplit: 0, ySplit: options.freezeRow }
        : {}),
    },
  ];
  ws.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: {
      left: 0.5,
      right: 0.5,
      top: 0.6,
      bottom: 0.6,
      header: 0.3,
      footer: 0.3,
    },
    horizontalCentered: true,
    ...(options.printTitleRow
      ? { printTitlesRow: `${options.printTitleRow}:${options.printTitleRow}` }
      : {}),
  };
  ws.headerFooter.oddFooter =
    "&L&8Laporan Statistik Bandara - A-SMGCS&R&8Halaman &P dari &N";
}

/** Judul tiga baris di kiri atas (baris 2-4), digabung sampai kolom terakhir isi. */
export function writeTitleBlock(
  ws: ExcelJs.Worksheet,
  lastCol: number,
  title: string,
  subtitle: string,
  note?: string,
): void {
  const rows: Array<[number, string, Partial<ExcelJs.Font>]> = [
    [
      2,
      title,
      { name: FONT_NAME, size: 16, bold: true, color: { argb: COLOR.navy } },
    ],
    [
      3,
      subtitle,
      { name: FONT_NAME, size: 10, color: { argb: COLOR.subtitle } },
    ],
  ];
  if (note) {
    rows.push([
      4,
      note,
      { name: FONT_NAME, size: 9, color: { argb: COLOR.note } },
    ]);
  }
  for (const [row, text, font] of rows) {
    ws.mergeCells(row, 2, row, lastCol);
    const cell = ws.getCell(row, 2);
    cell.value = text;
    cell.font = font;
    cell.alignment = { vertical: "middle", wrapText: true };
  }
  ws.getRow(2).height = 24;
}

export function writeSectionTitle(
  ws: ExcelJs.Worksheet,
  row: number,
  text: string,
): void {
  const cell = ws.getCell(row, 2);
  cell.value = text;
  cell.font = {
    name: FONT_NAME,
    size: 12,
    bold: true,
    color: { argb: COLOR.navy },
  };
  ws.getRow(row).height = 20;
}

/** Baris judul tabel: latar navy, teks putih tebal di tengah. */
export function writeHeaderRow(
  ws: ExcelJs.Worksheet,
  row: number,
  labels: string[],
  startCol = 2,
): void {
  labels.forEach((label, i) => {
    const cell = ws.getCell(row, startCol + i);
    cell.value = label;
    cell.font = {
      name: FONT_NAME,
      size: 11,
      bold: true,
      color: { argb: COLOR.white },
    };
    cell.fill = fill(COLOR.navy);
    cell.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
    cell.border = BORDER;
  });
  ws.getRow(row).height = 22;
}

export type CellKind = "text" | "input" | "calc";

export interface BodyCell {
  value: ExcelJs.CellValue;
  kind?: CellKind;
  fmt?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  fillArgb?: string;
  fontArgb?: string;
  wrap?: boolean;
}

/**
 * Satu baris isi tabel. Teks biru = angka masukan dari sistem, teks hitam = hasil rumus
 * (aturan yang dijelaskan di sheet Legenda).
 */
export function writeBodyRow(
  ws: ExcelJs.Worksheet,
  row: number,
  cells: BodyCell[],
  zebra: boolean,
  startCol = 2,
): void {
  cells.forEach((c, i) => {
    const cell = ws.getCell(row, startCol + i);
    cell.value = c.value;
    const color = c.fontArgb ?? (c.kind === "input" ? COLOR.input : COLOR.text);
    cell.font = {
      name: FONT_NAME,
      size: 10,
      bold: c.bold ?? false,
      color: { argb: color },
    };
    cell.fill = fill(c.fillArgb ?? (zebra ? COLOR.zebra : COLOR.white));
    cell.border = BORDER;
    if (c.fmt) cell.numFmt = c.fmt;
    cell.alignment = {
      horizontal: c.align ?? (typeof c.value === "string" ? "left" : "right"),
      vertical: "top",
      wrapText: c.wrap ?? false,
    };
  });
}

/** Baris TOTAL: latar biru muda dan huruf tebal. */
export function writeTotalRow(
  ws: ExcelJs.Worksheet,
  row: number,
  cells: BodyCell[],
  startCol = 2,
): void {
  writeBodyRow(
    ws,
    row,
    cells.map((c) => ({ ...c, bold: true, fillArgb: COLOR.cardA })),
    false,
    startCol,
  );
}

/** Catatan kecil abu-abu yang digabung dan dibungkus di bawah tabel. */
export function writeNote(
  ws: ExcelJs.Worksheet,
  row: number,
  lastCol: number,
  text: string,
  widthChars: number,
): void {
  ws.mergeCells(row, 2, row, lastCol);
  const cell = ws.getCell(row, 2);
  cell.value = text;
  cell.font = { name: FONT_NAME, size: 9, color: { argb: COLOR.note } };
  cell.alignment = { vertical: "top", wrapText: true };
  ws.getRow(row).height = wrappedHeight(text, widthChars, 12);
}

/** Batang data di dalam sel (hanya warna dan panjang; tipe bawaan ExcelJS belum memuat `color`). */
export function dataBarRule(): ExcelJs.DataBarRuleType {
  return {
    type: "dataBar",
    priority: 1,
    minLength: 0,
    maxLength: 100,
    gradient: false,
    border: false,
    color: { argb: COLOR.bar },
    cfvo: [{ type: "min" }, { type: "max" }],
  } as unknown as ExcelJs.DataBarRuleType;
}
