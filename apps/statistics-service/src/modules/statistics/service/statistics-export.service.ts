import { reportFilename } from "../lib/report-format";
import { buildOperationalReport } from "../lib/report-workbook";
import type { GetOperationalStatisticsParams } from "../validator/statistics.validator";
import { getOperationalStatistics } from "./statistics.service";

const DEFAULT_AIRPORT_ID = "WARR";

export interface OperationalReportFile {
  filename: string;
  contentType: string;
  data: Uint8Array<ArrayBuffer>;
}

export const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Laporan Excel dari statistik operasional dengan filter yang sama seperti
 * `GET /statistics/operational` (periode, rentang tanggal/jam, keparahan, bandara).
 */
export async function exportOperationalReport(
  params: GetOperationalStatisticsParams,
  now: Date = new Date(),
): Promise<OperationalReportFile> {
  const result = await getOperationalStatistics(params);
  const workbook = buildOperationalReport(result, {
    airportId:
      params.airportId ??
      process.env.AEROSWARM_AIRPORT_ID ??
      DEFAULT_AIRPORT_ID,
    generatedAt: now,
    severity: params.severity,
  });
  const buffer = await workbook.xlsx.writeBuffer();

  return {
    filename: reportFilename(params.period, params.startDate, params.endDate),
    contentType: XLSX_CONTENT_TYPE,
    data: new Uint8Array(buffer),
  };
}
