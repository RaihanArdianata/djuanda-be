import { logger } from "@repo/logger";
import { Kafka } from "kafkajs";
import { env } from "@/config/env";

const kafka =
  env.KAFKA_BROKERS.length > 0
    ? new Kafka({
        clientId: "advisory-service",
        brokers: env.KAFKA_BROKERS.split(","),
      })
    : null;

const producer = kafka?.producer();

export type AftnEventType = "AFTN_RECEIVED" | "AFTN_UPDATED";

export interface AftnEvent {
  eventType: AftnEventType;
  timestamp: string;
  data: {
    airportId: string;
  };
}

export async function startAdvisoryProducer(): Promise<void> {
  if (!producer) {
    logger.info("Advisory producer not configured");
    return;
  }
  await producer.connect();
  logger.info("Advisory producer connected");
}

export async function stopAdvisoryProducer(): Promise<void> {
  if (!producer) return;
  await producer.disconnect().catch((err: unknown) => {
    logger.warn({ err }, "Advisory producer disconnect failed");
  });
}

export async function publishAftnEvent(
  eventType: AftnEventType,
  airportId: string,
): Promise<void> {
  if (!producer) return;
  const event: AftnEvent = {
    eventType,
    timestamp: new Date().toISOString(),
    data: { airportId },
  };
  await producer.send({
    topic: env.KAFKA_ADVISORY_TOPIC,
    messages: [{ key: airportId, value: JSON.stringify(event) }],
  });
}
