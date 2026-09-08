import type { ServerWebSocket } from "bun";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { subscribeToTopic } from "../sse/service";

const clients = new Map<ServerWebSocket, Set<string>>();
const redisUnsubs = new Map<ServerWebSocket, () => Promise<void>>();

export const wsHandler = upgradeWebSocket((c) => {
  const topic = c.req.param("topic");
  if (!topic) {
    return Promise.reject(new Response("Missing topic", { status: 400 }));
  }

  return {
    onOpen(_: Event, ws: WSContext): void {
      const rawWs = ws.raw as ServerWebSocket;
      if (!clients.has(rawWs)) {
        clients.set(rawWs, new Set());
      }
      clients.get(rawWs)?.add(topic);
      rawWs.subscribe(topic);

      const unsubscribe = subscribeToTopic(topic, (message: string): void => {
        rawWs.publish(topic, message);
      });
      redisUnsubs.set(rawWs, unsubscribe);
    },
    onMessage(evt: MessageEvent, ws: WSContext): void {
      const rawWs = ws.raw as ServerWebSocket;
      const topics = clients.get(rawWs);

      if (!topics) return;

      for (const subscribedTopic of topics) {
        rawWs.publish(subscribedTopic, evt.data.toString());
      }
    },
    onClose(_: CloseEvent, ws: WSContext): void {
      const rawWs = ws.raw as ServerWebSocket;
      const topics = clients.get(rawWs);

      if (topics) {
        for (const topic of topics) {
          rawWs.unsubscribe(topic);
        }
      }

      const unsubscribe = redisUnsubs.get(rawWs);
      if (unsubscribe) {
        void unsubscribe();
        redisUnsubs.delete(rawWs);
      }

      clients.delete(rawWs);
    },
  };
});

export const broadcastToTopic = (topic: string, message: string): void => {
  for (const [ws, topics] of clients.entries()) {
    if (topics.has(topic)) {
      ws.send(message);
    }
  }
};
