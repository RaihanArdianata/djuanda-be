import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { alertServiceEnv } from "../../config/env";
import { trackUpdated } from "../../context/surveillance.context";
import {
  type AlertTrackHistoryPoint,
  recordAlertTrackHistory,
} from "../alert/service/alert.service";
import { processTrackUpdate } from "../engine/alert.engine";
import {
  appendPostHistory,
  getActiveAlertIdsForMovementTrack,
  type PostHistoryAppendResult,
} from "../engine/alert-post-history";
import { pushTrackHistory } from "../engine/track-history";
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

function postHistoryToDbPoint(
  result: PostHistoryAppendResult,
): AlertTrackHistoryPoint {
  const { alertId, kind, record } = result;
  return {
    alertId,
    kind,
    trackId: record.trackId,
    targetType: record.targetType ?? null,
    callsign: record.callsign ?? null,
    registration: record.registration ?? null,
    latitude: record.latitude,
    longitude: record.longitude,
    altitude: record.altitude,
    groundSpeed: record.groundSpeed,
    heading: record.heading,
    onGround: record.onGround,
    timestamp: new Date(record.timestamp),
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

function appendAndPersistPostHistory(track: MovementTrack): void {
  const postHistoryPoints: AlertTrackHistoryPoint[] = [];
  for (const alertId of getActiveAlertIdsForMovementTrack(track)) {
    const result = appendPostHistory(alertId, track);
    if (result) {
      postHistoryPoints.push(postHistoryToDbPoint(result));
    }
  }
  if (postHistoryPoints.length > 0) {
    recordAlertTrackHistory(postHistoryPoints).catch((err) => {
      // Post-history write boleh gagal tanpa memutus consumer,
      // karena in-memory post history masih akan tersedia.
      logger.error(
        { err, count: postHistoryPoints.length },
        "track consumer: failed to persist post-history points",
      );
    });
  }
}

async function handleTrackMessage(
  message: EachMessagePayload["message"],
): Promise<void> {
  if (!message.value) return;

  const raw = JSON.parse(message.value.toString());
  if (raw.eventType !== "TRACK_UPDATED" || !raw.data) return;

  const event = raw as TrackUpdatedEvent;
  const track = toMovementTrack(event);
  pushTrackHistory(track);
  await trackUpdated(track);
  await processTrackUpdate(track);

  // Setelah evaluate, tambahkan posisi ini ke post-history alert aktif
  // dan langsung persist ke tabel alert_track_history.
  appendAndPersistPostHistory(track);
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
    // Default 1 = satu partisi diproses per waktu secara bergiliran — track
    // update rate tinggi bikin queue numpuk dan occupancy/SSE telat.
    partitionsConsumedConcurrently: 3,
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      try {
        await handleTrackMessage(message);
      } catch (err) {
        // Throw supaya offset tidak di-commit dan KafkaJS me-retry pesan
        // (backoff bawaan). Swallow di sini = alert hilang diam-diam.
        logger.error({ err }, "track consumer: failed to process message");
        throw err;
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
