import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { env } from "../../config/env";
import { publishRealtimeEvent } from "./redis-publisher";

let consumer: Consumer | null = null;

export type MovementEventType = "MOVEMENT_RECORDED";
export type MovementApiType = "TAKE_OFF" | "LANDING";

export interface MovementRecordedEvent {
  eventType: MovementEventType;
  timestamp: string;
  data: {
    id: string;
    trackId: string;
    airportId: string;
    type: MovementApiType;
    callsign?: string;
    icao24?: string;
    eventTime: string;
  };
}

export function isMovementRecordedEvent(
  value: unknown,
): value is MovementRecordedEvent {
  const e = value as Record<string, unknown> | null;
  if (!e || e.eventType !== "MOVEMENT_RECORDED") return false;
  const data = e.data as Record<string, unknown> | undefined;
  return (
    typeof data?.id === "string" &&
    typeof data?.trackId === "string" &&
    typeof data?.airportId === "string" &&
    (data?.type === "TAKE_OFF" || data?.type === "LANDING") &&
    typeof data?.eventTime === "string"
  );
}

export interface RealtimeMovementPayload {
  topic: string;
  payload: {
    id: string;
    type: string;
    timestamp: string;
    data: {
      id: string;
      trackId: string;
      callsign?: string;
      icao24?: string;
      airportId: string;
      type: MovementApiType;
      eventTime: string;
    };
  };
}
export function toRealtimePayload(
  event: MovementRecordedEvent,
): RealtimeMovementPayload {
  const { data } = event;
  const topic =
    data.type === "TAKE_OFF" ? "movement.takeoff" : "movement.landing";

  return {
    topic,
    payload: {
      id: data.id,
      type: topic,
      timestamp: new Date().toISOString(),
      data: {
        id: data.id,
        trackId: data.trackId,
        ...(data.callsign ? { callsign: data.callsign } : {}),
        ...(data.icao24 ? { icao24: data.icao24 } : {}),
        airportId: data.airportId,
        type: data.type,
        eventTime: data.eventTime,
      },
    },
  };
}

export async function startMovementConsumer(): Promise<void> {
  if (env.KAFKA_BROKERS.length === 0) {
    logger.info(
      "Statistics Kafka brokers not configured — movement consumer disabled",
    );
    return;
  }

  const kafka = new Kafka({
    clientId: "statistics-service",
    brokers: env.KAFKA_BROKERS.split(",")
      .map((b) => b.trim())
      .filter(Boolean),
  });

  consumer = kafka.consumer({ groupId: env.KAFKA_MOVEMENT_CONSUMER_GROUP });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "movement consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: env.KAFKA_MOVEMENT_TOPIC,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      if (!message.value) return;
      try {
        const raw: unknown = JSON.parse(message.value.toString());
        if (!isMovementRecordedEvent(raw)) {
          logger.warn(
            {
              keys:
                raw && typeof raw === "object" ? Object.keys(raw) : typeof raw,
            },
            "movement consumer: unrecognized event shape — dropped",
          );
          return;
        }

        const { topic, payload } = toRealtimePayload(raw);
        await publishRealtimeEvent(topic, payload);
      } catch (err) {
        logger.warn({ err }, "movement consumer: failed to process message");
      }
    },
  });

  logger.info(
    {
      brokers: env.KAFKA_BROKERS,
      topic: env.KAFKA_MOVEMENT_TOPIC,
      groupId: env.KAFKA_MOVEMENT_CONSUMER_GROUP,
    },
    "movement consumer started",
  );
}

export async function stopMovementConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer
    .disconnect()
    .catch((err) =>
      logger.warn({ err }, "movement consumer disconnect failed"),
    );
  consumer = null;
}
