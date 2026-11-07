import { z } from "zod";

const envSchema = z.object({
  WEATHER_SERVICE_PORT: z.coerce.number().default(3008),
  WEATHER_STATION_ICAO: z.string().default("WARR"),
  BMKG_API_BASE_URL: z.url().default("https://web-aviation.bmkg.go.id/api/v1"),
  BMKG_API_TOKEN: z.string().default(""),
  METAR_POLL_INTERVAL_MS: z.coerce.number().default(1_800_000),
  SPECI_POLL_INTERVAL_MS: z.coerce.number().default(300_000),
  TAF_POLL_INTERVAL_MS: z.coerce.number().default(3_600_000),
  PROVIDER_TIMEOUT_MS: z.coerce.number().default(5000),
  PROVIDER_MAX_RETRIES: z.coerce.number().default(3),
  PROVIDER_RETRY_BASE_DELAY_MS: z.coerce.number().default(1000),
  OBSERVATION_STALE_MINUTES: z.coerce.number().default(45),

  KAFKA_BROKERS: z.string().default(""),
  KAFKA_WEATHER_TOPIC: z.string().default("asmgcs.weather"),
});

export const env = envSchema.parse(process.env);
