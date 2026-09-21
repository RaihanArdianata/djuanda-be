import { logger } from "@repo/logger";
import { getPublisher, publishToTopic } from "@repo/shared/sse/publisher";
import type Redis from "ioredis";

export type { TopicMessageHandler } from "@repo/shared/sse/publisher";
export { publishToTopic };

export function createSubscriber(): Redis {
  return getPublisher().duplicate();
}

export function subscribeToTopic(
  topic: string,
  onMessage: (message: string) => void | Promise<void>,
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

export function subscribeToAll(
  onMessage: (message: string, topic: string) => void | Promise<void>,
): () => Promise<void> {
  const sub = createSubscriber();
  const pattern = "events:*";
  let closed = false;

  sub.on("error", (err) => {
    logger.error({ err }, `[SSE Redis] all-subscriber error on ${pattern}`);
  });

  sub.psubscribe(pattern, (err) => {
    if (err) {
      logger.error({ err }, `[SSE Redis] failed to psubscribe to ${pattern}`);
    }
  });

  sub.on("pmessage", (_pattern, channel, message) => {
    if (closed) return;
    const topic = channel.replace(/^events:/, "");
    void onMessage(message, topic);
  });

  return async function unsubscribe(): Promise<void> {
    if (closed) return;
    closed = true;
    sub.removeAllListeners("pmessage");
    try {
      await sub.punsubscribe(pattern);
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
