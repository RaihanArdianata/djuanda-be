import type { AftnMessage } from "@repo/database";
import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { alertServiceEnv } from "@/config/env";
import { cacheAftnMessage } from "@/context/advisory.context";

let consumer: Consumer | null = null;

export async function startAdvisoryConsumer(): Promise<void> {
  if (alertServiceEnv.kafkaBrokers.length === 0) {
    logger.info(
      "Alert Kafka brokers not configured — advisory consumer disabled",
    );
    return;
  }

  const kafka = new Kafka({
    clientId: "alert-service",
    brokers: alertServiceEnv.kafkaBrokers,
  });

  consumer = kafka.consumer({
    groupId: alertServiceEnv.kafkaConsumerGroup,
  });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "advisory consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: alertServiceEnv.kafkaAdvisoryTopic,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      if (!message.value) return;
      try {
        const raw = JSON.parse(message.value.toString());
        if (
          (raw.eventType === "AFTN_RECEIVED" ||
            raw.eventType === "AFTN_UPDATED") &&
          raw.data?.message
        ) {
          await cacheAftnMessage(raw.data.message as AftnMessage);
        }
      } catch (err) {
        logger.warn({ err }, "advisory consumer: failed to process message");
      }
    },
  });

  logger.info(
    {
      brokers: alertServiceEnv.kafkaBrokers,
      topic: alertServiceEnv.kafkaAdvisoryTopic,
      groupId: alertServiceEnv.kafkaConsumerGroup,
    },
    "advisory consumer started",
  );
}

export async function stopAdvisoryConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer
    .disconnect()
    .catch((err) =>
      logger.warn({ err }, "advisory consumer disconnect failed"),
    );
  consumer = null;
}
