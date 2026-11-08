import { aerodromeFeatures, db } from "@repo/database";
import { logger } from "@repo/logger";
import { eq } from "drizzle-orm";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { env } from "@/config/env";
import { publishAerodromeGeometryUpdated } from "./aerodrome.producer";

let consumer: Consumer | null = null;

export type AerodromeObjectStatusUpdatedEventType =
  "aerodrome.object.status.updated";

export interface AerodromeObjectStatusUpdatedEvent {
  eventType: AerodromeObjectStatusUpdatedEventType;
  timestamp: string;
  data: {
    airportId: string;
    objectType: "RUNWAY" | "TAXIWAY" | "APRON";
    objectId: string;
    status: "AVAILABLE" | "BLOCKED" | "CLOSED" | "RESTRICTED";
    notamId: string;
    effectiveFrom: string;
    effectiveTo?: string;
  };
}

function toDbStatus(
  status: AerodromeObjectStatusUpdatedEvent["data"]["status"],
): "ACTIVE" | "INACTIVE" | "RESTRICTED" {
  switch (status) {
    case "AVAILABLE":
      return "ACTIVE";
    case "BLOCKED":
    case "CLOSED":
      return "INACTIVE";
    case "RESTRICTED":
      return "RESTRICTED";
    default:
      return "INACTIVE";
  }
}

export async function startAerodromeConsumer(): Promise<void> {
  if (env.KAFKA_BROKERS.length === 0) {
    logger.info(
      "Aerodrome Kafka brokers not configured — aerodrome consumer disabled",
    );
    return;
  }

  const kafka = new Kafka({
    clientId: "aerodrome-service",
    brokers: env.KAFKA_BROKERS.split(","),
  });

  consumer = kafka.consumer({ groupId: "aerodrome-service" });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "aerodrome consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: env.KAFKA_AERODROME_TOPIC,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload) => {
      if (!message.value) return;
      try {
        const raw = JSON.parse(message.value.toString());
        if (raw.eventType !== "aerodrome.object.status.updated" || !raw.data)
          return;

        const event = raw as AerodromeObjectStatusUpdatedEvent;
        const {
          airportId,
          objectId,
          status,
          notamId,
          effectiveFrom,
          effectiveTo,
        } = event.data;

        const matched = await db.query.aerodromeFeatures.findFirst({
          where: eq(aerodromeFeatures.id, objectId),
        });

        if (!matched) {
          logger.warn(
            { airportId, objectId, notamId },
            "aerodrome object not found",
          );
          return;
        }

        const previous = (matched.properties ?? {}) as Record<string, unknown>;

        await db
          .update(aerodromeFeatures)
          .set({
            status: toDbStatus(status),
            properties: {
              ...previous,
              // Terbatas hanya selama NOTAM-nya membatasi; AVAILABLE/BLOCKED/CLOSED melepas tanda terbatas lama.
              restricted: status === "RESTRICTED",
              notamId,
              notamStatus: status,
              notamEffectiveFrom: effectiveFrom,
              notamEffectiveTo: effectiveTo ?? null,
              notamUpdatedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(aerodromeFeatures.id, objectId));

        await publishAerodromeGeometryUpdated(airportId);

        logger.info(
          { airportId, objectId, status, notamId },
          "aerodrome object status updated",
        );
      } catch (err) {
        logger.warn({ err }, "aerodrome consumer: failed to process message");
      }
    },
  });

  logger.info(
    { brokers: env.KAFKA_BROKERS, topic: env.KAFKA_AERODROME_TOPIC },
    "aerodrome consumer started",
  );
}

export async function stopAerodromeConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer.disconnect().catch((err: unknown) => {
    logger.warn({ err }, "aerodrome consumer disconnect failed");
  });
  consumer = null;
}
