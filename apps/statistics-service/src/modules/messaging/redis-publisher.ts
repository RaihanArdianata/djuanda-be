import { redisConfig } from "@repo/config";
import { logger } from "@repo/logger";
import Redis from "ioredis";

const publisher = new Redis({
  ...redisConfig,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  retryStrategy: (times: number): number | null => (times > 5 ? null : 2000),
});

publisher.on("error", (err) => {
  logger.error(
    { err },
    "[statistics-service redis publisher] connection error",
  );
});

export async function publishRealtimeEvent(
  topic: string,
  payload: unknown,
): Promise<void> {
  const channel = `events:${topic}`;
  const message =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  await publisher.publish(channel, message);
}

export async function closeRealtimePublisher(): Promise<void> {
  await publisher.quit().catch(() => {
    // already closed — fine
  });
}
