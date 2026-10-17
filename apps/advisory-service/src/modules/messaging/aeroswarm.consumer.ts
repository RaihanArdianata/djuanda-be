import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { env } from "@/config/env";
import { mapAeroswarmFlightPlanEvent } from "../aftn/parser/aeroswarm.mapper";
import { upsertAftnMessage } from "../aftn/repository/aftn.repository";
import { type AftnEventType, publishAftnEvent } from "./advisory.producer";

export const AEROSWARM_AFTN_SOURCE = "aeroswarm";

let consumer: Consumer | null = null;

const outcomeToEventType: Record<"created" | "updated", AftnEventType> = {
  created: "AFTN_RECEIVED",
  updated: "AFTN_UPDATED",
};

async function handleMessage(raw: string): Promise<void> {
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch (err) {
    // JSON rusak itu deterministik — retry Kafka tidak akan memperbaikinya,
    // jadi pesan di-skip supaya tidak jadi poison pill.
    logger.warn(
      { err, raw: raw.slice(0, 200) },
      "aeroswarm flightplan consumer: invalid JSON — skipped",
    );
    return;
  }

  const message = mapAeroswarmFlightPlanEvent(event);
  if (!message) return;

  const outcome = await upsertAftnMessage(message, {
    source: AEROSWARM_AFTN_SOURCE,
    providerRaw: event as Record<string, unknown>,
  });
  if (outcome === "unchanged") return;

  const airports = [message.departure, message.destination].filter(
    (a): a is string => typeof a === "string" && a.length > 0,
  );
  for (const airportId of new Set(airports)) {
    await publishAftnEvent(outcomeToEventType[outcome], airportId);
  }
}

export async function startAeroswarmFlightPlanConsumer(): Promise<void> {
  if (!env.AEROSWARM_FLIGHTPLAN_ENABLED) {
    logger.info("aeroswarm flightplan consumer disabled via env");
    return;
  }
  if (env.KAFKA_BROKERS.length === 0) {
    logger.info(
      "Kafka brokers not configured — aeroswarm flightplan consumer disabled",
    );
    return;
  }

  const kafka = new Kafka({
    clientId: "advisory-service",
    brokers: env.KAFKA_BROKERS.split(","),
  });

  consumer = kafka.consumer({ groupId: env.AEROSWARM_FLIGHTPLAN_GROUP });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "aeroswarm flightplan consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: env.AEROSWARM_FLIGHTPLAN_TOPIC,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      try {
        if (message.value) await handleMessage(message.value.toString());
      } catch (err) {
        // Throw supaya offset tidak di-commit dan KafkaJS me-retry — kegagalan
        // persist (DB down) bersifat sementara; swallow di sini = pesan AFTN
        // hilang diam-diam.
        logger.error(
          { err },
          "aeroswarm flightplan consumer: failed to process message",
        );
        throw err;
      }
    },
  });

  logger.info(
    {
      topic: env.AEROSWARM_FLIGHTPLAN_TOPIC,
      groupId: env.AEROSWARM_FLIGHTPLAN_GROUP,
    },
    "aeroswarm flightplan consumer started",
  );
}

export async function stopAeroswarmFlightPlanConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer
    .disconnect()
    .catch((err) =>
      logger.warn({ err }, "aeroswarm flightplan consumer disconnect failed"),
    );
  consumer = null;
}
