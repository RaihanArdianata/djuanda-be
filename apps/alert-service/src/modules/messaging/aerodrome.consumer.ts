import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { deleteAerodromeGeometry } from "@/cache/context.cache";
import { alertServiceEnv } from "@/config/env";
import { getAerodromeContext } from "@/context/aerodrome.context";

let consumer: Consumer | null = null;

export async function startAerodromeConsumer(): Promise<void> {
  if (alertServiceEnv.kafkaBrokers.length === 0) {
    logger.info(
      "Alert Kafka brokers not configured — aerodrome consumer disabled",
    );
    return;
  }

  const kafka = new Kafka({
    clientId: "alert-service",
    brokers: alertServiceEnv.kafkaBrokers,
  });

  consumer = kafka.consumer({
    groupId: alertServiceEnv.kafkaConsumerGroup,
  });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "aerodrome consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: alertServiceEnv.kafkaAerodromeTopic,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      if (!message.value) return;
      try {
        const raw = JSON.parse(message.value.toString());
        logger.info({ raw }, "aerodrome consumer: message received");
        if (
          raw.eventType === "AERODROME_GEOMETRY_UPDATED" &&
          raw.data?.airportId
        ) {
          const airportId = raw.data.airportId as string;
          logger.info({ airportId }, "aerodrome consumer: invalidating cache");
          await deleteAerodromeGeometry(airportId);
          await getAerodromeContext(airportId);
        }
      } catch (err) {
        logger.warn({ err }, "aerodrome consumer: failed to process message");
      }
    },
  });

  logger.info(
    {
      brokers: alertServiceEnv.kafkaBrokers,
      topic: alertServiceEnv.kafkaAerodromeTopic,
      groupId: alertServiceEnv.kafkaConsumerGroup,
    },
    "aerodrome consumer started",
  );
}

export async function stopAerodromeConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer
    .disconnect()
    .catch((err) =>
      logger.warn({ err }, "aerodrome consumer disconnect failed"),
    );
  consumer = null;
}
