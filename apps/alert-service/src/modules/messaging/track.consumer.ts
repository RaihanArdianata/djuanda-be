import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { alertServiceEnv } from "../../config/env";
import { trackUpdated } from "../../context/surveillance.context";
import { processTrackUpdate } from "../engine/alert.engine";
import type { MovementTrack } from "../engine/types";

let consumer: Consumer | null = null;

export interface TrackUpdatedEvent {
  eventType: "TRACK_UPDATED";
  timestamp: string;
  data: {
    trackId: string;
    airportId: string;
    targetType: "AIRCRAFT" | "VEHICLE" | string;
    latitude: number;
    longitude: number;
    altitudeFt?: number;
    groundSpeedKt?: number;
    heading?: number;
    onGround?: boolean;
    callsign?: string;
    registration?: string;
    aircraftType?: string;
    vehicleFleet?: string;
    lifecycle?: string;
  };
}

function toMovementTrack(event: TrackUpdatedEvent): MovementTrack {
  const { data } = event;
  return {
    trackId: data.trackId,
    airportId: data.airportId,
    targetType: data.targetType,
    latitude: data.latitude,
    longitude: data.longitude,
    altitude: data.altitudeFt,
    groundSpeed: data.groundSpeedKt,
    heading: data.heading,
    onGround: data.onGround,
    timestamp: new Date(event.timestamp),
    callsign: data.callsign,
    registration: data.registration,
    aircraftType: data.aircraftType,
    vehicleFleet: data.vehicleFleet,
    lifecycle: data.lifecycle,
  };
}

export async function startTrackConsumer(): Promise<void> {
  if (alertServiceEnv.kafkaBrokers.length === 0) {
    logger.info("Alert Kafka brokers not configured — track consumer disabled");
    return;
  }

  const kafka = new Kafka({
    clientId: "alert-service",
    brokers: alertServiceEnv.kafkaBrokers,
  });

  consumer = kafka.consumer({
    groupId: `${alertServiceEnv.kafkaConsumerGroup}-track`,
  });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "track consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: alertServiceEnv.kafkaTrackTopic,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      if (!message.value) return;
      try {
        const raw = JSON.parse(message.value.toString());
        if (raw.eventType !== "TRACK_UPDATED" || !raw.data) return;

        const event = raw as TrackUpdatedEvent;
        const track = toMovementTrack(event);
        await trackUpdated(track);
        await processTrackUpdate(track);
      } catch (err) {
        logger.warn({ err }, "track consumer: failed to process message");
      }
    },
  });

  logger.info(
    {
      brokers: alertServiceEnv.kafkaBrokers,
      topic: alertServiceEnv.kafkaTrackTopic,
      groupId: `${alertServiceEnv.kafkaConsumerGroup}-track`,
    },
    "track consumer started",
  );
}

export async function stopTrackConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer
    .disconnect()
    .catch((err) => logger.warn({ err }, "track consumer disconnect failed"));
  consumer = null;
}
