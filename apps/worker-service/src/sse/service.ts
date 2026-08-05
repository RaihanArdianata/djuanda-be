import { redisConfig } from "@repo/config";
import { logger } from "@repo/logger";
import Redis from "ioredis";

export const publisher = new Redis({
  ...redisConfig,
  maxRetriesPerRequest: 1,
  connectTimeout: 2000,
  retryStrategy: (times: number): number | null => (times > 5 ? null : 2000),
});

export function createSubscriber(): Redis {
  return publisher.duplicate();
}

export async function publishToTopic(
  topic: string,
  payload: unknown,
): Promise<void> {
  const channel = `events:${topic}`;
  const message =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  await publisher.publish(channel, message);
}

export type TopicMessageHandler = (message: string) => void | Promise<void>;

/**
 * Subscribes to a topic channel on a dedicated connection.
 * Returns an unsubscribe function to clean up when the SSE
 * client disconnects.
 */
export function subscribeToTopic(
  topic: string,
  onMessage: TopicMessageHandler,
): () => Promise<void> {
  const sub = createSubscriber();
  const channel = `events:${topic}`;
  let closed = false;

  sub.on("error", (err) => {
    logger.error({ err }, `[SSE Redis] subscriber error on ${channel}`);
  });

  sub.subscribe(channel, (err) => {
    if (err) {
      logger.error({ err }, `[SSE Redis] failed to subscribe to ${channel}`);
    }
  });

  sub.on("message", (receivedChannel, message) => {
    if (receivedChannel === channel) {
      void onMessage(message);
    }
  });

  return async function unsubscribe(): Promise<void> {
    if (closed) return;
    closed = true;
    sub.removeAllListeners("message");
    try {
      await sub.unsubscribe(channel);
    } catch {
      // already unsubscribed/disconnected — fine
    }
    try {
      await sub.quit();
    } catch {
      // already closed — fine
    }
  };
}
