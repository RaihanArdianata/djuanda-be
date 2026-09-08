import { z } from "zod";

const envSchema = z.object({
  KAFKA_BROKERS: z.string().default(""),
  KAFKA_MOVEMENT_TOPIC: z.string().default("asmgcs.movement"),
  KAFKA_MOVEMENT_CONSUMER_GROUP: z
    .string()
    .default("statistics-service-movement"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
