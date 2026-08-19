import { logger } from "@repo/logger";
import { type Consumer, type EachMessagePayload, Kafka } from "kafkajs";
import { alertServiceEnv } from "@/config/env";
import { cacheWeather } from "@/context/weather.context";
import type { WeatherContextData } from "../engine/types";

let consumer: Consumer | null = null;

export async function startWeatherConsumer(): Promise<void> {
  if (alertServiceEnv.kafkaBrokers.length === 0) {
    logger.info(
      "Alert Kafka brokers not configured — weather consumer disabled",
    );
    return;
  }

  const kafka = new Kafka({
    clientId: "alert-service",
    brokers: alertServiceEnv.kafkaBrokers,
  });

  consumer = kafka.consumer({
    groupId: `${alertServiceEnv.kafkaConsumerGroup}-weather`,
  });

  consumer.on(consumer.events.CRASH, ({ payload }) => {
    logger.error(
      { err: payload.error, restarting: payload.restart },
      "weather consumer crashed",
    );
  });

  await consumer.connect();
  await consumer.subscribe({
    topic: alertServiceEnv.kafkaWeatherTopic,
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
      if (!message.value) return;
      try {
        const raw = JSON.parse(message.value.toString());
        if (raw.eventType === "WEATHER_UPDATED" && raw.data?.airportId) {
          await cacheWeather(
            raw.data.airportId,
            raw.data as WeatherContextData,
          );
        }
      } catch (err) {
        logger.warn({ err }, "weather consumer: failed to process message");
      }
    },
  });

  logger.info(
    {
      brokers: alertServiceEnv.kafkaBrokers,
      topic: alertServiceEnv.kafkaWeatherTopic,
      groupId: `${alertServiceEnv.kafkaConsumerGroup}-weather`,
    },
    "weather consumer started",
  );
}

export async function stopWeatherConsumer(): Promise<void> {
  if (!consumer) return;
  await consumer
    .disconnect()
    .catch((err) => logger.warn({ err }, "weather consumer disconnect failed"));
  consumer = null;
}
