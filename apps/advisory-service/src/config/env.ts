import { z } from "zod";

const envSchema = z.object({
  ADVISORY_SERVICE_PORT: z.coerce.number().default(3007),

  ADVISORY_PROVIDER_BASE_URL: z.string().min(1),
  ADVISORY_PROVIDER_USERNAME: z.string().min(1),
  ADVISORY_PROVIDER_PASSWORD: z.string().min(1),
  ADVISORY_PROVIDER_TIMEOUT_MS: z.coerce.number().default(20_000),
  ADVISORY_PROVIDER_TOKEN_LIFETIME_MS: z.coerce.number().default(900_000),

  // Dipakai bareng sync NOTAM/ASHTAM (window overlap anti-duplikat) — AFTN
  // tidak lagi pakai sync berkala; datanya stream via aeroswarm consumer.
  ADVISORY_SYNC_OVERLAP_MS: z.coerce.number().default(300_000),

  ADVISORY_ASHTAM_SYNC_INTERVAL_MS: z.coerce.number().default(1_800_000),
  ADVISORY_ASHTAM_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  KAFKA_BROKERS: z.string().default(""),
  KAFKA_ADVISORY_TOPIC: z.string().default("asmgcs.advisory"),
  KAFKA_AERODROME_TOPIC: z.string().default("asmgcs.aerodrome"),

  // AFTN via AeroSwarm — connector di AeroSwarm meneruskan event
  // aero.flightplan.v1 ke topic ini di redpanda backend (dibuat oleh
  // redpanda-init). Consumer menulis ke aftn_messages lalu republish ke
  // KAFKA_ADVISORY_TOPIC — pipeline downstream identik dengan sync NAVSIM.
  AEROSWARM_FLIGHTPLAN_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  AEROSWARM_FLIGHTPLAN_TOPIC: z.string().default("aeroswarm.flightplan.warr"),
  AEROSWARM_FLIGHTPLAN_GROUP: z.string().default("asmgcs-advisory-aftn"),
  ADVISORY_NOTAM_SYNC_INTERVAL_MS: z.coerce.number().default(1_800_000),
  ADVISORY_NOTAM_SYNC_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
