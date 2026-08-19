import { logger } from "@repo/logger";
import { Kafka } from "kafkajs";
import { env } from "@/config/env";

const kafka =
  env.KAFKA_BROKERS.length > 0
    ? new Kafka({
        clientId: "aerodrome-service",
        brokers: env.KAFKA_BROKERS.split(","),
      })
    : null;

const producer = kafka?.producer();

export type AerodromeGeometryEventType = "AERODROME_GEOMETRY_UPDATED";

export interface AerodromeGeometryEvent {
  eventType: AerodromeGeometryEventType;
  timestamp: string;
  data: {
    airportId: string;
  };
}

export async function startAerodromeProducer(): Promise<void> {
  if (!producer) {
    logger.info("Aerodrome producer not configured");
    return;
  }
  await producer.connect();
  logger.info("Aerodrome producer connected");
}

export async function stopAerodromeProducer(): Promise<void> {
  if (!producer) return;
  await producer.disconnect().catch((err: unknown) => {
    logger.warn({ err }, "Aerodrome producer disconnect failed");
  });
}

export async function publishAerodromeGeometryUpdated(
  airportId: string,
): Promise<void> {
  if (!producer) return;
  const event: AerodromeGeometryEvent = {
    eventType: "AERODROME_GEOMETRY_UPDATED",
    timestamp: new Date().toISOString(),
    data: { airportId },
  };
  await producer.send({
    topic: env.KAFKA_AERODROME_TOPIC,
    messages: [{ key: airportId, value: JSON.stringify(event) }],
  });
}
