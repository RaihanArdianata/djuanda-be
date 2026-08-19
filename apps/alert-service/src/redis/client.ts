import { redisConfig } from "@repo/config";
import { Redis } from "ioredis";

export const redis = new Redis({
  ...redisConfig,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
});
