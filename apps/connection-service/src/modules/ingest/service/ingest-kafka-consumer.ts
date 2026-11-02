import type { FusedTrackEvent } from "@aeroswarm/core";
import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { feedMetrics } from "../../feed/feed-metrics";
import { applySurfaceState } from "../../feed/surface-state";
import {
  isCoveredDuplicate,
  isFlightPlanShape,
  type PrimaryFeedGate,
} from "../lib/primary-feed-gate";
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

async function parseMessageValue(
  raw: Buffer | null,
  gate?: PrimaryFeedGate,
): Promise<void> {
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
    logger.warn(
      { raw: raw.toString() },
      "kafka ingest: message is not valid JSON",
    );
    return;
  }

  const { id, airportId } = getIngestEventIdentity(event);
  const kind = getIngestLogKind(event);

  if (kind === "unknown" && isFlightPlanShape(event)) {
    // AFTN yang diteruskan AeroSwarm ke topic ini; AFTN sudah diterima lewat UDP langsung.
    return;
  }

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

  // Radar/MLAT yang sama juga masuk lewat feed UDP langsung dengan trackId lain: bila jalur itu
  // sudah mencakup pesawatnya, event ini kembar dan dibuang (lihat primary-feed-gate.ts).
  if (isCoveredDuplicate(gate, kind, event)) {
    feedMetrics.ingestDuplicatesDropped.inc();
    recordIngestLog({
      source: "kafka",
      kind,
      status: "duplicate",
      id,
      airportId,
    });
    return;
  }

  // Buffer-only enqueue (awaitFlush: false) — awaiting the timed flush per
  // message throttles the consumer to ~1 batch per 500ms, which cannot keep
  // up with the simulator feed rate. applyBackpressure still pauses the
  // consumer when the buffer is full, and the offset is only committed for
  // events at most MAX_BUFFER behind the durable flush.
  try {
    // Track dari AeroSwarm disimpan dengan status darat/udara yang sama seperti feed langsung.
    const toStore =
      kind === "track" ? applySurfaceState(event as FusedTrackEvent) : event;
    await enqueueIngestEvent(toStore, { awaitFlush: false });
    recordIngestLog({
      source: "kafka",
      kind,
      status: "accepted",
      id,
      airportId,
    });
  } catch (err) {
    recordIngestLog({
      source: "kafka",
      kind,
      status: "error",
      id,
      airportId,
      message: err instanceof Error ? err.message : "enqueue/flush error",
    });
    logger.error(
      { err, id, kind },
      "kafka ingest: enqueue/flush failed — message will not be committed",
    );
    throw err;
  }
}

/** No-op (consumer stays unset) when AEROSWARM_INGEST_KAFKA_BROKERS is
 *  unset — the http/websocket ingest paths work independently of this. */
export interface IngestKafkaConsumerOptions {
  /** Penyaring event kembar dari jalur utama; tanpa ini semua event diterima. */
  gate?: PrimaryFeedGate;
}

export async function startIngestKafkaConsumer(
  options: IngestKafkaConsumerOptions = {},
): Promise<void> {
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
    partitionsConsumedConcurrently: 3,
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      await parseMessageValue(message.value, options.gate);
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
