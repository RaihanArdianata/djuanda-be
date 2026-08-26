import type { Alert } from "@repo/database";
import { clearActiveAlert } from "../../cache/alert-state.cache";
import {
  acknowledgeAlert as repoAcknowledgeAlert,
  clearAlert as repoClearAlert,
  clearAlertByAlertId as repoClearAlertByAlertId,
} from "../alert/repository/alert.repository";
import { broadcastAlert } from "../alert/service/alert-broadcast.service";
import {
  type AlertEvent,
  type AlertEventType,
  publishAlertEvent,
} from "../messaging/alert.producer";

function toAlertEvent(alert: Alert, eventType: AlertEventType): AlertEvent {
  return {
    eventType,
    timestamp: new Date().toISOString(),
    data: {
      alertId: alert.alertId,
      airportId: alert.airportId,
      type: alert.type,
      severity: alert.severity,
      status: alert.status,
      trackId: alert.trackId,
      relatedTrackId: alert.relatedTrackId,
    },
  };
}

export async function publishAlertCreated(alert: Alert): Promise<void> {
  await publishAlertEvent(toAlertEvent(alert, "ALERT_CREATED"));
  broadcastAlert(alert, "ALERT_CREATED");
}

export async function publishAlertUpdated(alert: Alert): Promise<void> {
  await publishAlertEvent(toAlertEvent(alert, "ALERT_UPDATED"));
  broadcastAlert(alert, "ALERT_UPDATED");
}

export async function publishAlertAcknowledged(alert: Alert): Promise<void> {
  await publishAlertEvent(toAlertEvent(alert, "ALERT_ACKNOWLEDGED"));
  broadcastAlert(alert, "ALERT_ACKNOWLEDGED");
}

export async function publishAlertCleared(alert: Alert): Promise<void> {
  await publishAlertEvent(toAlertEvent(alert, "ALERT_CLEARED"));
  broadcastAlert(alert, "ALERT_CLEARED");
}

export async function acknowledgeAlert(
  id: string,
  acknowledgedBy?: string,
): Promise<Alert | undefined> {
  const alert = await repoAcknowledgeAlert(id, acknowledgedBy);
  if (alert) await publishAlertAcknowledged(alert);
  return alert;
}

export async function clearAlert(
  id: string,
  clearedBy?: string,
): Promise<Alert | undefined> {
  const alert = await repoClearAlert(id, clearedBy);
  if (alert) {
    await clearActiveAlertByAlertId(alert.alertId);
    await publishAlertCleared(alert);
  }
  return alert;
}

export async function clearAlertByAlertId(
  alertId: string,
  clearedBy?: string,
): Promise<Alert | undefined> {
  const alert = await repoClearAlertByAlertId(alertId, clearedBy);
  if (alert) {
    await clearActiveAlertByAlertId(alert.alertId);
    await publishAlertCleared(alert);
  }
  return alert;
}

async function clearActiveAlertByAlertId(alertId: string): Promise<void> {
  const parts = alertId.split("|");
  if (parts.length < 3) return;
  const type = parts[0] as string;
  const rest = parts.slice(1);
  const airportId = rest[0] as string;
  const entityKey = rest.join("|");
  await clearActiveAlert(airportId, type, entityKey);
}
