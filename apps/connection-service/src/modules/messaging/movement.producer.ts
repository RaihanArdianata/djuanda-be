import type { AeroswarmMovement } from "@repo/database";
import { logger } from "@repo/logger";
import { Kafka, type Producer } from "kafkajs";
import { buildMovementId } from "../ingest/lib/movement-id";

const KAFKA_BROKERS: string = process.env.KAFKA_BROKERS || "";
const KAFKA_MOVEMENT_TOPIC: string =
  process.env.KAFKA_MOVEMENT_TOPIC || "asmgcs.movement";

const kafka =
  KAFKA_BROKERS.length > 0
    ? new Kafka({
        clientId: "connection-service",
        brokers: KAFKA_BROKERS.split(",")
          .map((b) => b.trim())
          .filter(Boolean),
        requestTimeout: 30000,
        retry: {
          initialRetryTime: 300,
          retries: 5,
        },
      })
    : null;

const producer: Producer | undefined = kafka?.producer();
const PRODUCER_SEND_TIMEOUT_MS = Number(
  process.env.MOVEMENT_PRODUCER_SEND_TIMEOUT_MS || 10000,
);

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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

const DB_TO_API_MOVEMENT_TYPE: Record<"takeoff" | "landing", MovementApiType> =
  {
    takeoff: "TAKE_OFF",
    landing: "LANDING",
  };

export async function startMovementProducer(): Promise<void> {
  if (!producer) {
    logger.info("Movement producer not configured");
    return;
  }
  await producer.connect();
  logger.info("Movement producer connected");
}

export async function stopMovementProducer(): Promise<void> {
  if (!producer) return;
  await producer.disconnect().catch((err: unknown) => {
    logger.warn({ err }, "Movement producer disconnect failed");
  });
}

export function buildMovementRecordedEvent(
  row: Pick<
    AeroswarmMovement,
    "trackId" | "type" | "airportId" | "callsign" | "icao24" | "at"
  >,
): MovementRecordedEvent | null {
  if (row.type !== "takeoff" && row.type !== "landing") return null;
  if (!row.airportId) return null;

  return {
    eventType: "MOVEMENT_RECORDED",
    timestamp: new Date().toISOString(),
    data: {
      id: buildMovementId(row.trackId, row.type, row.at),
      trackId: row.trackId,
      airportId: row.airportId,
      type: DB_TO_API_MOVEMENT_TYPE[row.type],
      ...(row.callsign ? { callsign: row.callsign } : {}),
      ...(row.icao24 ? { icao24: row.icao24 } : {}),
      eventTime: row.at.toISOString(),
    },
  };
}
export async function publishMovementRecorded(
  row: AeroswarmMovement,
): Promise<void> {
  const event = buildMovementRecordedEvent(row);
  if (!event) {
    logger.info(
      { trackId: row.trackId, type: row.type, airportId: row.airportId },
      "publishMovementRecorded: skipped, not a takeoff/landing with airportId",
    );
    return;
  }
  if (!producer) {
    logger.info(
      { trackId: row.trackId },
      "publishMovementRecorded: no producer configured, skipping",
    );
    return;
  }

  await withTimeout(
    producer.send({
      topic: KAFKA_MOVEMENT_TOPIC,
      messages: [{ key: row.trackId, value: JSON.stringify(event) }],
    }),
    PRODUCER_SEND_TIMEOUT_MS,
    `producer.send(${KAFKA_MOVEMENT_TOPIC})`,
  );

  logger.info(
    { topic: KAFKA_MOVEMENT_TOPIC, trackId: row.trackId, type: row.type },
    "publishMovementRecorded: published",
  );
}
