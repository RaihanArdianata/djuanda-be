import type { Alert } from "@repo/database";
import { logger } from "@repo/logger";
import { publishToTopic } from "@repo/shared/sse/publisher";
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
  publishAlertEvents,
} from "../messaging/alert.producer";
import { flushPostHistory } from "./alert-post-history";
import { buildEntityKey } from "./track-history";

// Urutan penting: broadcast SSE (Redis) dulu, baru Kafka. producer.send bisa
// menggantung lama (retry/backoff kafkajs) saat broker bermasalah — kalau
// ditunggu duluan, event live ke FE ikut tertahan.
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
  await broadcastAlert(alert, "ALERT_CREATED");
  await publishAlertEvent(toAlertEvent(alert, "ALERT_CREATED"));
}

export async function publishAlertUpdated(alert: Alert): Promise<void> {
  await broadcastAlert(alert, "ALERT_UPDATED");
  await publishAlertEvent(toAlertEvent(alert, "ALERT_UPDATED"));
}

export async function publishAlertAcknowledged(alert: Alert): Promise<void> {
  await broadcastAlert(alert, "ALERT_ACKNOWLEDGED");
  await publishAlertEvent(toAlertEvent(alert, "ALERT_ACKNOWLEDGED"));
}

export async function publishAlertCleared(alert: Alert): Promise<void> {
  await broadcastAlert(alert, "ALERT_CLEARED");
  await publishAlertEvent(toAlertEvent(alert, "ALERT_CLEARED"));
}

export async function publishAlertVerified(alert: Alert): Promise<void> {
  await broadcastAlert(alert, "ALERT_VERIFIED");
  await publishAlertEvent(toAlertEvent(alert, "ALERT_VERIFIED"));
}

/**
 * Verifikasi massal: satu siaran SSE untuk seluruh kelompok (klien cukup memuat ulang) dan satu pengiriman Kafka, bukan satu per alert.
 */
export async function publishAlertsVerifiedBatch(
  verified: Alert[],
): Promise<void> {
  if (verified.length === 0) return;
  try {
    await publishToTopic(
      "alerts",
      JSON.stringify({
        eventType: "ALERT_VERIFIED",
        timestamp: new Date().toISOString(),
        bulk: true,
        alertIds: verified.map((a) => a.alertId),
      }),
    );
  } catch (err) {
    logger.warn({ err }, "failed to broadcast bulk verification to Redis");
  }
  await publishAlertEvents(
    verified.map((a) => toAlertEvent(a, "ALERT_VERIFIED")),
  );
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
  params?: { clearedBy?: string; reason?: string } | string,
): Promise<Alert | undefined> {
  const clearParams =
    typeof params === "string" ? { clearedBy: params } : params;
  let alert = await repoClearAlert(id, clearParams);
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
  params?: { clearedBy?: string; reason?: string } | string,
): Promise<Alert | undefined> {
  const clearParams =
    typeof params === "string" ? { clearedBy: params } : params;
  let alert = await repoClearAlertByAlertId(alertId, clearParams);
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
