import type { Alert } from "@repo/database";
import { clearActiveAlert } from "../../cache/alert-state.cache";
import {
  mergeAlertData,
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
import { flushPostHistory } from "./alert-post-history";
import { buildEntityKey } from "./track-history";

function toAlertEvent(alert: Alert, eventType: AlertEventType): AlertEvent {
  return {
    eventType,
    timestamp: new Date().toISOString(),
    data: {
      ...(alert.data ?? {}),
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
  await broadcastAlert(alert, "ALERT_CREATED");
}

export async function publishAlertUpdated(alert: Alert): Promise<void> {
  await publishAlertEvent(toAlertEvent(alert, "ALERT_UPDATED"));
  await broadcastAlert(alert, "ALERT_UPDATED");
}

export async function publishAlertAcknowledged(alert: Alert): Promise<void> {
  await publishAlertEvent(toAlertEvent(alert, "ALERT_ACKNOWLEDGED"));
  await broadcastAlert(alert, "ALERT_ACKNOWLEDGED");
}

export async function publishAlertCleared(alert: Alert): Promise<void> {
  await publishAlertEvent(toAlertEvent(alert, "ALERT_CLEARED"));
  await broadcastAlert(alert, "ALERT_CLEARED");
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
  let alert = await repoClearAlert(id, clearedBy);
  if (alert) {
    const { main, related } = flushPostHistory(alert.alertId);
    alert =
      (await mergeAlertData(alert.alertId, {
        postTrackHistory: main,
        postRelatedTrackHistory: related,
      })) ?? alert;
    await clearActiveAlertForAlert(alert);
    await publishAlertCleared(alert);
  }
  return alert;
}

export async function clearAlertByAlertId(
  alertId: string,
  clearedBy?: string,
): Promise<Alert | undefined> {
  let alert = await repoClearAlertByAlertId(alertId, clearedBy);
  if (alert) {
    const { main, related } = flushPostHistory(alert.alertId);
    alert =
      (await mergeAlertData(alert.alertId, {
        postTrackHistory: main,
        postRelatedTrackHistory: related,
      })) ?? alert;
    await clearActiveAlertForAlert(alert);
    await publishAlertCleared(alert);
  }
  return alert;
}

async function clearActiveAlertForAlert(alert: Alert): Promise<void> {
  const data = alert.data as Record<string, unknown> | null | undefined;
  const entityKey =
    typeof data?.entityKey === "string"
      ? data.entityKey
      : buildEntityKey({
          trackId: alert.trackId,
          relatedTrackId: alert.relatedTrackId,
          aerodromeFeatureId: alert.aerodromeFeatureId,
        });
  await clearActiveAlert(alert.airportId, alert.type, entityKey);
}
