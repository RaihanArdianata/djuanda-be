import { logger } from "@repo/logger";
import { Kafka } from "kafkajs";
import { alertServiceEnv } from "../../config/env";

const kafka =
  alertServiceEnv.kafkaBrokers.length > 0
    ? new Kafka({
        clientId: "alert-service",
        brokers: alertServiceEnv.kafkaBrokers,
      })
    : null;

const producer = kafka?.producer();

export type AlertEventType =
  | "ALERT_CREATED"
  | "ALERT_UPDATED"
  | "ALERT_ACKNOWLEDGED"
  | "ALERT_CLEARED";

export interface AlertEvent {
  eventType: AlertEventType;
  timestamp: string;
  data: {
    alertId: string;
    type: string;
    severity: string;
    status: string;
    trackId: string;
    relatedTrackId?: string | null;
    airportId: string;
  };
}

export async function startAlertProducer(): Promise<void> {
  if (!producer) {
    logger.info("Alert producer not configured");
    return;
  }
  await producer.connect();
  logger.info("Alert producer connected");
}

export async function stopAlertProducer(): Promise<void> {
  if (!producer) return;
  await producer.disconnect().catch((err) => {
    logger.warn({ err }, "Alert producer disconnect failed");
  });
}

export async function publishAlertEvent(event: AlertEvent): Promise<void> {
  if (!producer) return;
  await producer.send({
    topic: alertServiceEnv.kafkaAlertTopic,
    messages: [
      {
        key: event.data.alertId,
        value: JSON.stringify(event),
      },
    ],
  });
}
