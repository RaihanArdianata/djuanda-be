import type { MetarParsedData, TafParsedData } from "@repo/database";
import { logger } from "@repo/logger";
import { Kafka } from "kafkajs";
import { env } from "@/config/env";

const kafka =
  env.KAFKA_BROKERS.length > 0
    ? new Kafka({
        clientId: "weather-service",
        brokers: env.KAFKA_BROKERS.split(","),
      })
    : null;

const producer = kafka?.producer();

export type WeatherEventType = "WEATHER_UPDATED";

export interface WeatherEvent {
  eventType: WeatherEventType;
  timestamp: string;
  data: {
    airportId: string;
    station: string;
    current: MetarParsedData | null;
    forecast: TafParsedData | null;
  };
}

export async function startWeatherProducer(): Promise<void> {
  if (!producer) {
    logger.info("Weather producer not configured");
    return;
  }
  await producer.connect();
  logger.info("Weather producer connected");
}

export async function stopWeatherProducer(): Promise<void> {
  if (!producer) return;
  await producer.disconnect().catch((err: unknown) => {
    logger.warn({ err }, "Weather producer disconnect failed");
  });
}

export async function publishWeatherEvent(
  airportId: string,
  station: string,
  current: MetarParsedData | null,
  forecast: TafParsedData | null,
): Promise<void> {
  if (!producer) return;
  const event: WeatherEvent = {
    eventType: "WEATHER_UPDATED",
    timestamp: new Date().toISOString(),
    data: { airportId, station, current, forecast },
  };
  await producer.send({
    topic: env.KAFKA_WEATHER_TOPIC,
    messages: [{ key: airportId, value: JSON.stringify(event) }],
  });
}
