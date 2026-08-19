import { z } from "zod";

const envSchema = z.object({
  ADVISORY_SERVICE_PORT: z.coerce.number().default(3007),

  ADVISORY_PROVIDER_BASE_URL: z.string().min(1),
  ADVISORY_PROVIDER_USERNAME: z.string().min(1),
  ADVISORY_PROVIDER_PASSWORD: z.string().min(1),
  ADVISORY_PROVIDER_TIMEOUT_MS: z.coerce.number().default(20_000),
  ADVISORY_PROVIDER_TOKEN_LIFETIME_MS: z.coerce.number().default(900_000),

  ADVISORY_SYNC_INTERVAL_MS: z.coerce.number().default(600_000),
  ADVISORY_SYNC_OVERLAP_MS: z.coerce.number().default(300_000),
  ADVISORY_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  KAFKA_BROKERS: z.string().default(""),
  KAFKA_ADVISORY_TOPIC: z.string().default("asmgcs.advisory"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
