import { Kafka, type Consumer } from "kafkajs";
import { logger } from "@repo/logger";
import {
  AirportMismatchError,
  assertExpectedAirport,
  enqueueAlertEvent,
  enqueueTrackEvent,
  isAlertEvent,
  isTrackEvent,
} from "./ingest.service";

// Low-throughput-ceiling alternative to the HTTP webhook (one POST per
// event — TCP/TLS/HTTP overhead per message, plus AeroSwarm's connector-side
// retry/DLQ path can't outrun a sustained rate above what the receiver can
// answer per second) and to the low-latency WS ingest (drops events while
// disconnected, no buffering). Kafka/Redpanda buffers in the BROKER: a
// connection-service restart or brief outage just delays consumption —
// nothing is lost as long as it catches up within the topic's retention
// window (see docker-compose.yml's redpanda-init: 1h/512MB by default).
//
// Message value is the raw event JSON — AeroSwarm's KafkaSink
// (@aeroswarm/connectors ^0.3.1) sends the whole FusedTrackEvent/AlertEvent
// as the message body (same shape the webhook sink wraps and the websocket
// sink sends bare), so this parses exactly like ingest-socket.ts's WS path.

let consumer: Consumer | null = null;

function parseMessageValue(raw: Buffer | null): void {
  if (!raw) return;
  let event: unknown;
  try {
    event = JSON.parse(raw.toString());
  } catch {
    return; // malformed message — skip, don't crash the consumer loop
  }

  if (isTrackEvent(event) || isAlertEvent(event)) {
    try {
      assertExpectedAirport(event);
    } catch (err) {
      if (err instanceof AirportMismatchError) {
        // No per-message secret on this transport (auth is broker
        // reachability only, see the module comment above) — this check is
        // the only thing standing between a misrouted topic/broker and a
        // silent cross-airport write. Log loudly and skip (commit the
        // offset, same as a malformed message) rather than crash the
        // consumer loop — a permanent config mismatch will never resolve
        // itself by retrying the same message.
        logger.error(
          { err, trackId: (event as { trackId?: string }).trackId, alertId: (event as { alertId?: string }).alertId },
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
  logger.warn(
    { keys: event && typeof event === "object" ? Object.keys(event) : typeof event },
    "kafka ingest: unrecognized event shape — dropped",
  );
}

/** No-op (consumer stays unset) when AEROSWARM_INGEST_KAFKA_BROKERS is
 *  unset — the http/websocket ingest paths work independently of this. */
export async function startIngestKafkaConsumer(): Promise<void> {
  const brokersEnv = process.env.AEROSWARM_INGEST_KAFKA_BROKERS;
  if (!brokersEnv) {
    logger.info("AEROSWARM_INGEST_KAFKA_BROKERS not set — kafka ingest disabled");
    return;
  }

  const brokers = brokersEnv.split(",").map((b) => b.trim()).filter(Boolean);
  const topic = process.env.AEROSWARM_INGEST_KAFKA_TOPIC || "aeroswarm.ingest.warr";
  const groupId = process.env.AEROSWARM_INGEST_KAFKA_GROUP_ID || "connection-service";

  const kafka = new Kafka({ clientId: "connection-service", brokers });
  consumer = kafka.consumer({ groupId });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error({ err: payload.error, restarting: payload.restart }, "kafka ingest consumer crashed");
  });

  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      parseMessageValue(message.value);
    },
  });

  logger.info({ brokers, topic, groupId }, "kafka ingest consumer started");
}

export async function stopIngestKafkaConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer.disconnect().catch((err) => logger.warn({ err }, "kafka consumer disconnect failed"));
  consumer = null;
}
