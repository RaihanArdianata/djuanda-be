import { redisConfig } from "@repo/config";
import { logger } from "@repo/logger";
import Redis from "ioredis";

let publisher: Redis | null = null;

function createPublisher(): Redis {
  const client = new Redis({
    ...redisConfig,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: (times: number): number | null => (times > 5 ? null : 2000),
  });

  client.on("error", (err) => {
    logger.error({ err }, "[SSE Redis] publisher error");
  });

  return client;
}

export function getPublisher(): Redis {
  if (!publisher) {
    publisher = createPublisher();
  }
  return publisher;
}

export async function publishToTopic(
  topic: string,
  payload: unknown,
): Promise<void> {
  const channel = `events:${topic}`;
  const message =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  await getPublisher().publish(channel, message);
}

export type TopicMessageHandler = (message: string) => void | Promise<void>;
