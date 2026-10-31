import type { FlightPlanEvent } from "@aeroswarm/core";
import { logger } from "@repo/logger";
import { Kafka } from "kafkajs";

/** The slice of a kafkajs producer this needs, so it can be faked in tests. */
export interface ProducerLike {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(record: {
    topic: string;
    messages: Array<{ key: string; value: string }>;
  }): Promise<unknown>;
}

export interface FlightPlanPublisher {
  /** False when no broker is configured; `publish` is then a no-op. */
  readonly enabled: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Rejects when Kafka does; callers decide whether that matters. */
  publish(event: FlightPlanEvent): Promise<void>;
}

export interface FlightPlanPublisherOptions {
  brokers: string[];
  topic: string;
  /** Test seam. Default: a kafkajs producer on `brokers`. */
  producer?: ProducerLike;
}

const DEFAULT_TOPIC = "aeroswarm.flightplan.warr";

/**
 * Publishes AFTN `FlightPlanEvent`s in the shape advisory-service already
 * consumes (`{ messageId, sourceId, feedId, airportId, receivedAt, message }`),
 * so its consumer and mapper do not change.
 *
 * Keyed by callsign: all messages of one flight stay in one partition, in order.
 */
export function createFlightPlanPublisher(
  opts: FlightPlanPublisherOptions,
): FlightPlanPublisher {
  const producer: ProducerLike | null =
    opts.producer ??
    (opts.brokers.length > 0
      ? new Kafka({
          clientId: "connection-service",
          brokers: opts.brokers,
        }).producer()
      : null);

  return {
    enabled: producer !== null,
    async start(): Promise<void> {
      if (!producer) {
        logger.info(
          "no Kafka broker for flight plans (AFTN_KAFKA_BROKERS / KAFKA_BROKERS) — AFTN stays in memory and is not forwarded to advisory-service",
        );
        return;
      }
      await producer.connect();
      logger.info(
        { brokers: opts.brokers, topic: opts.topic },
        "flight plan producer connected",
      );
    },
    async stop(): Promise<void> {
      if (!producer) return;
      await producer
        .disconnect()
        .catch((err: unknown) =>
          logger.warn({ err }, "flight plan producer disconnect failed"),
        );
    },
    async publish(event: FlightPlanEvent): Promise<void> {
      if (!producer) return;
      const key =
        event.message.callsign?.trim().toUpperCase() || event.messageId;
      await producer.send({
        topic: opts.topic,
        messages: [{ key, value: JSON.stringify(event) }],
      });
    },
  };
}

export function flightPlanPublisherFromEnv(
  env: Record<string, string | undefined>,
): FlightPlanPublisher {
  const brokers = (
    env.AFTN_KAFKA_BROKERS ??
    env.AEROSWARM_TRACK_KAFKA_BROKERS ??
    env.KAFKA_BROKERS ??
    ""
  )
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);
  return createFlightPlanPublisher({
    brokers,
    topic: env.AEROSWARM_FLIGHTPLAN_TOPIC || DEFAULT_TOPIC,
  });
}
