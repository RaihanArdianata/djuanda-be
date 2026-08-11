import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import {
  AirportMismatchError,
  assertExpectedAirport,
  enqueueAlertEvent,
  enqueueMovementEvent,
  enqueueTrackEvent,
  isAlertEvent,
  isMovementEvent,
  isTrackEvent,
} from "./ingest.service";

let consumer: Consumer | null = null;

function parseMessageValue(raw: Buffer | null): void {
  if (!raw) return;
  let event: unknown;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return;
  }

  if (isTrackEvent(event) || isAlertEvent(event) || isMovementEvent(event)) {
    try {
      assertExpectedAirport(event);
    } catch (err) {
      if (err instanceof AirportMismatchError) {
        logger.error(
          {
            err,
            trackId: (event as { trackId?: string }).trackId,
            alertId: (event as { alertId?: string }).alertId,
          },
          "kafka ingest: airport mismatch — event dropped",
        );
        return;
      }
      throw err;
    }
  }

  if (isTrackEvent(event)) {
    enqueueTrackEvent(event);
    return;
  }
  if (isAlertEvent(event)) {
    enqueueAlertEvent(event);
    return;
  }
  if (isMovementEvent(event)) {
    enqueueMovementEvent(event);
    return;
  }
  logger.warn(
    {
      keys:
        event && typeof event === "object" ? Object.keys(event) : typeof event,
    },
    "kafka ingest: unrecognized event shape — dropped",
  );
}

/** No-op (consumer stays unset) when AEROSWARM_INGEST_KAFKA_BROKERS is
 *  unset — the http/websocket ingest paths work independently of this. */
export async function startIngestKafkaConsumer(): Promise<void> {
  const brokersEnv = process.env.AEROSWARM_INGEST_KAFKA_BROKERS;
  if (!brokersEnv) {
    logger.info(
      "AEROSWARM_INGEST_KAFKA_BROKERS not set — kafka ingest disabled",
    );
    return;
  }

  const brokers = brokersEnv
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
  const topic =
    process.env.AEROSWARM_INGEST_KAFKA_TOPIC || "aeroswarm.ingest.warr";
  const groupId =
    process.env.AEROSWARM_INGEST_KAFKA_GROUP_ID || "connection-service";

  const kafka = new Kafka({ clientId: "connection-service", brokers });
  consumer = kafka.consumer({ groupId });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "kafka ingest consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      parseMessageValue(message.value);
    },
  });

  logger.info({ brokers, topic, groupId }, "kafka ingest consumer started");
}

export async function stopIngestKafkaConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer
    .disconnect()
    .catch((err) => logger.warn({ err }, "kafka consumer disconnect failed"));
  consumer = null;
}
