import { z } from "zod";

const envSchema = z.object({
  AERODROME_SERVICE_PORT: z.coerce.number().default(3009),

  KAFKA_BROKERS: z.string().default(""),
  KAFKA_AERODROME_TOPIC: z.string().default("asmgcs.aerodrome"),
});

export const env = envSchema.parse(process.env);
