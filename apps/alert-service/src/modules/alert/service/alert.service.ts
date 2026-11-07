import type { Alert, AlertAction } from "@repo/database";
import ApiError from "@repo/shared/api-error";
import {
  acknowledgeAlert as lifecycleAcknowledgeAlert,
  clearAlert as lifecycleClearAlert,
  publishAlertVerified,
} from "../../engine/alert.lifecycle";
import {
  type AlertTrackHistoryPoint,
  findAlertByAlertId,
  findAlertById,
  getAlertActions,
  getAlertsForExport,
  getAlertTrackHistory,
  type InsertAlertValues,
  insertAlertTrackHistory,
  type ListAlertsResult,
  listAlerts,
  recordAlertAction,
  softDeleteAlert as repoSoftDeleteAlert,
  verifyAlert as repoVerifyAlert,
  upsertAlertByAlertId,
} from "../repository/alert.repository";
import type {
  AcknowledgeAlertInput,
  BulkClearAlertInput,
  ClearAlertInput,
  DeleteAlertInput,
  ExportAlertInput,
  ListAlertsInput,
  VerifyAlertInput,
} from "../validator/alert.validator";
import {
  calculateAlertSummary,
  formatExportFilename,
  generateCsvExport,
  generateExcelExport,
} from "./alert-export.service";

export type AlertInput = InsertAlertValues;
export type { AlertTrackHistoryPoint } from "../repository/alert.repository";

export interface UserActor {
  id?: string;
  name?: string;
  username?: string;
}

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
  actor?: UserActor,
): Promise<Alert | undefined> {
  const alert = await findAlertById(id);
  if (!alert) return undefined;

  const actorName =
    input.acknowledgedBy ?? actor?.name ?? actor?.username ?? "system";
  const updatedAlert = await lifecycleAcknowledgeAlert(id, actorName);

  if (updatedAlert) {
    await recordAlertAction({
      alertId: alert.alertId,
      action: "ACKNOWLEDGE",
      actorId: actor?.id ?? null,
      actorName,
      previousStatus: alert.status,
      newStatus: "ACKNOWLEDGED",
    });
  }

  return updatedAlert;
}

export async function clearAlertService(
  id: string,
  input: ClearAlertInput,
  actor?: UserActor,
): Promise<Alert | undefined> {
  const alert = await findAlertById(id);
  if (!alert) return undefined;

  if (alert.status === "CLEARED") {
    throw new ApiError("BAD_REQUEST", { message: "Alert is already cleared" });
  }

  const actorName =
    input.clearedBy ?? actor?.name ?? actor?.username ?? "system";
  const reason = input.reason ?? input.note;

  const updatedAlert = await lifecycleClearAlert(id, {
    clearedBy: actorName,
    reason,
  });

  if (updatedAlert) {
    await recordAlertAction({
      alertId: alert.alertId,
      action: "CLEAR",
      actorId: actor?.id ?? null,
      actorName,
      previousStatus: alert.status,
      newStatus: "CLEARED",
      note: reason,
    });
  }

  return updatedAlert;
}

export interface BulkClearItemResult {
  id: string;
  reason?: string;
}

export interface BulkClearResult {
  succeeded: string[];
  failed: BulkClearItemResult[];
  total: number;
  successCount: number;
  failureCount: number;
}

export async function bulkClearAlertsService(
  input: BulkClearAlertInput,
  actor?: UserActor,
): Promise<BulkClearResult> {
  const succeeded: string[] = [];
  const failed: BulkClearItemResult[] = [];
  const actorName =
    input.clearedBy ?? actor?.name ?? actor?.username ?? "system";
  const reason = input.reason;

  for (const id of input.alertIds) {
    try {
      const alert = await findAlertById(id);
      if (!alert) {
        failed.push({ id, reason: "Alert not found" });
        continue;
      }
      if (alert.status === "CLEARED") {
        failed.push({ id, reason: "Alert is already cleared" });
        continue;
      }

      const updated = await lifecycleClearAlert(id, {
        clearedBy: actorName,
        reason,
      });

      if (updated) {
        await recordAlertAction({
          alertId: alert.alertId,
          action: "CLEAR",
          actorId: actor?.id ?? null,
          actorName,
          previousStatus: alert.status,
          newStatus: "CLEARED",
          note: reason,
        });
        succeeded.push(id);
      } else {
        failed.push({ id, reason: "Failed to update alert" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to clear alert";
      failed.push({ id, reason: msg });
    }
  }

  return {
    succeeded,
    failed,
    total: input.alertIds.length,
    successCount: succeeded.length,
    failureCount: failed.length,
  };
}

export async function verifyAlertService(
  id: string,
  input: VerifyAlertInput,
  actor?: UserActor,
): Promise<Alert | undefined> {
  const alert = await findAlertById(id);
  if (!alert) return undefined;

  const actorName =
    input.verifiedBy ?? actor?.name ?? actor?.username ?? "system";

  const updatedAlert = await repoVerifyAlert(id, {
    status: input.status,
    note: input.note,
    verifiedBy: actorName,
  });

  if (updatedAlert) {
    await recordAlertAction({
      alertId: alert.alertId,
      action: "VERIFY",
      actorId: actor?.id ?? null,
      actorName,
      previousVerificationStatus: alert.verificationStatus,
      newVerificationStatus: input.status,
      note: input.note,
    });
    await publishAlertVerified(updatedAlert);
  }

  return updatedAlert;
}

export async function deleteAlertService(
  id: string,
  input?: DeleteAlertInput,
  actor?: UserActor,
): Promise<boolean> {
  const alert = await findAlertById(id);
  if (!alert) return false;

  const actorName =
    input?.deletedBy ?? actor?.name ?? actor?.username ?? "system";

  const deleted = await repoSoftDeleteAlert(id);
  if (deleted) {
    await recordAlertAction({
      alertId: alert.alertId,
      action: "DELETE",
      actorId: actor?.id ?? null,
      actorName,
      previousStatus: alert.status,
      newStatus: "DELETED",
      note: input?.reason,
    });
    return true;
  }
  return false;
}

export async function getAlertActionsService(
  id: string,
): Promise<AlertAction[] | undefined> {
  const alert = await findAlertById(id);
  if (!alert) return undefined;
  return getAlertActions(alert.alertId);
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
