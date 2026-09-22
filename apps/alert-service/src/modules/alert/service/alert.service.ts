import type { Alert } from "@repo/database";
import {
  acknowledgeAlert as lifecycleAcknowledgeAlert,
  clearAlert as lifecycleClearAlert,
} from "../../engine/alert.lifecycle";
import {
  type AlertTrackHistoryPoint,
  findAlertByAlertId,
  findAlertById,
  getAlertsForExport,
  getAlertTrackHistory,
  insertAlertTrackHistory,
  type ListAlertsResult,
  listAlerts,
  upsertAlertByAlertId,
} from "../repository/alert.repository";
import type {
  AcknowledgeAlertInput,
  ClearAlertInput,
  ExportAlertInput,
  ListAlertsInput,
} from "../validator/alert.validator";
import {
  calculateAlertSummary,
  formatExportFilename,
  generateCsvExport,
  generateExcelExport,
} from "./alert-export.service";

export type AlertInput = Omit<Alert, "id" | "createdAt" | "updatedAt">;
export type { AlertTrackHistoryPoint } from "../repository/alert.repository";

export async function getAllAlerts(
  params: ListAlertsInput,
): Promise<ListAlertsResult> {
  return listAlerts(params);
}

export async function getAlertById(id: string): Promise<Alert | undefined> {
  return findAlertById(id);
}

export async function getActiveAlerts(
  params: ListAlertsInput,
): Promise<ListAlertsResult> {
  return listAlerts({ ...params, status: "ACTIVE" });
}

export async function registerAlert(values: AlertInput): Promise<Alert> {
  return upsertAlertByAlertId(values);
}

export async function recordAlertTrackHistory(
  records: AlertTrackHistoryPoint[],
): Promise<void> {
  return insertAlertTrackHistory(records);
}

export async function findExistingAlert(
  alertId: string,
): Promise<Alert | undefined> {
  return findAlertByAlertId(alertId);
}

export { getAlertTrackHistory };

export async function acknowledgeAlertService(
  id: string,
  input: AcknowledgeAlertInput,
): Promise<Alert | undefined> {
  return lifecycleAcknowledgeAlert(id, input.acknowledgedBy);
}

export async function clearAlertService(
  id: string,
  input: ClearAlertInput,
): Promise<Alert | undefined> {
  return lifecycleClearAlert(id, input.clearedBy);
}

export * from "./alert-export.service";

export async function exportAlertsService(
  params: ExportAlertInput,
  authToken?: string,
): Promise<{
  filename: string;
  data: string | Buffer;
  contentType: string;
}> {
  const alertsList = await getAlertsForExport({
    airportId: params.airportId,
    type: params.type,
    alertType: params.alertType,
    severity: params.severity,
    status: params.status,
    trackId: params.trackId,
    startDateTime: params.startDateTime,
    endDateTime: params.endDateTime,
  });

  const filename = formatExportFilename(
    params.startDateTime,
    params.endDateTime,
    params.format,
  );

  if (params.format === "csv") {
    const csvContent = generateCsvExport(alertsList);
    return {
      filename,
      data: csvContent,
      contentType: "text/csv; charset=utf-8",
    };
  }

  const summary = calculateAlertSummary(alertsList);
  const excelBuffer = await generateExcelExport(
    alertsList,
    summary,
    {
      startDateTime: params.startDateTime,
      endDateTime: params.endDateTime,
      airportId: params.airportId,
    },
    authToken,
  );
  return {
    filename,
    data: excelBuffer,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
