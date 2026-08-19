import type { Alert } from "@repo/database";
import {
  acknowledgeAlert as lifecycleAcknowledgeAlert,
  clearAlert as lifecycleClearAlert,
} from "../../engine/alert.lifecycle";
import {
  findAlertByAlertId,
  findAlertById,
  type ListAlertsResult,
  listAlerts,
  upsertAlertByAlertId,
} from "../repository/alert.repository";
import type {
  AcknowledgeAlertInput,
  ClearAlertInput,
  ListAlertsInput,
} from "../validator/alert.validator";

export type AlertInput = Omit<Alert, "id" | "createdAt" | "updatedAt">;

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

export async function findExistingAlert(
  alertId: string,
): Promise<Alert | undefined> {
  return findAlertByAlertId(alertId);
}

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
