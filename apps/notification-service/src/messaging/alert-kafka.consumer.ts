import { db, users } from "@repo/database";
import { logger } from "@repo/logger";
import { eq } from "drizzle-orm";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { notificationServiceEnv } from "../config/env";
import { createNotification } from "../modules/notification/service/notification.service";

let consumer: Consumer | null = null;

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
    airportId: string;
  };
}

async function getActiveRecipientIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.status, "ACTIVE"));
  return rows.map((r) => r.id);
}

export async function startKafkaAlertConsumer(): Promise<void> {
  if (notificationServiceEnv.kafkaBrokers.length === 0) {
    logger.info(
      "Notification Kafka brokers not configured — alert Kafka consumer disabled",
    );
    return;
  }

  const kafka = new Kafka({
    clientId: "notification-service",
    brokers: notificationServiceEnv.kafkaBrokers,
  });

  consumer = kafka.consumer({
    groupId: notificationServiceEnv.kafkaConsumerGroup,
  });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "alert Kafka consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: notificationServiceEnv.kafkaAlertTopic,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      if (!message.value) return;

      let event: AlertEvent;
      try {
        const raw = JSON.parse(message.value.toString());
        if (!raw.eventType || !raw.data) return;
        event = raw as AlertEvent;
      } catch (err: unknown) {
        logger.warn({ err }, "alert Kafka consumer: failed to parse message");
        return;
      }

      const { data, eventType } = event;

      try {
        const recipientIds = await getActiveRecipientIds();

        if (recipientIds.length === 0) {
          logger.info(
            { alertId: data.alertId },
            "no active recipients for alert notification",
          );
          return;
        }

        await createNotification({
          title: `[${eventType}] ${data.type}`,
          message: `Alert ${data.alertId} at ${data.airportId} — severity: ${data.severity}, status: ${data.status}`,
          recipientIds,
        });

        logger.info(
          { alertId: data.alertId, eventType, recipients: recipientIds.length },
          "notification created from alert Kafka event",
        );
      } catch (err: unknown) {
        logger.error(
          { err, alertId: data.alertId },
          "failed to create notification from alert Kafka event",
        );
      }
    },
  });

  logger.info(
    {
      brokers: notificationServiceEnv.kafkaBrokers,
      topic: notificationServiceEnv.kafkaAlertTopic,
      groupId: notificationServiceEnv.kafkaConsumerGroup,
    },
    "alert Kafka consumer started",
  );
}

export async function stopKafkaAlertConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer
    .disconnect()
    .catch((err: unknown) =>
      logger.warn({ err }, "alert Kafka consumer disconnect failed"),
    );
  consumer = null;
}
