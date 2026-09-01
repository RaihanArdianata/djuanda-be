import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import {
  AirportMismatchError,
  assertExpectedAirport,
  enqueueIngestEvent,
  getIngestEventIdentity,
  getIngestLogKind,
  recordIngestLog,
} from "./ingest.service";

let consumer: Consumer | null = null;

function getEventKeys(event: unknown): string[] | string {
  return event && typeof event === "object" ? Object.keys(event) : typeof event;
}

function parseMessageValue(raw: Buffer | null): void {
  if (!raw) return;
  let event: unknown;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    recordIngestLog({
      source: "kafka",
      kind: "unknown",
      status: "rejected",
      message: "kafka ingest: message is not valid JSON",
    });
    return;
  }

  const { id, airportId } = getIngestEventIdentity(event);
  const kind = getIngestLogKind(event);

  if (kind === "unknown") {
    recordIngestLog({
      source: "kafka",
      kind: "unknown",
      status: "rejected",
      message: "kafka ingest: unrecognized event shape — dropped",
    });
    logger.warn(
      { keys: getEventKeys(event) },
      "kafka ingest: unrecognized event shape — dropped",
    );
    return;
  }

  try {
    assertExpectedAirport(event as { airportId?: string });
  } catch (err) {
    if (err instanceof AirportMismatchError) {
      recordIngestLog({
        source: "kafka",
        kind,
        status: "rejected",
        id,
        airportId,
        message: err.message,
      });
      logger.error(
        { err, trackId: id, alertId: id },
        "kafka ingest: airport mismatch — event dropped",
      );
      return;
    }
    throw err;
  }

  void enqueueIngestEvent(event);
  recordIngestLog({ source: "kafka", kind, status: "accepted", id, airportId });
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
