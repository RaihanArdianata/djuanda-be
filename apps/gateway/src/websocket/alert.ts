import { subscribeToTopic } from "@repo/shared/sse/publisher";
import type { ServerWebSocket } from "bun";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";

interface AlertBroadcastMessage {
  eventType: string;
  timestamp: string;
  alert: {
    airportId: string;
    [key: string]: unknown;
  };
}

export const alertWsHandler = upgradeWebSocket((c) => {
  const airportId = c.req.query("airportId") ?? undefined;
  const topics = c.req.query("topics")?.split(",").filter(Boolean) ?? [
    "alerts",
  ];

  const subscriptions = new Map<string, () => Promise<void>>();

  return {
    onOpen(_evt: Event, ws: WSContext): void {
      const rawWs = ws.raw as ServerWebSocket;

      for (const topic of topics) {
        const unsubscribe = subscribeToTopic(topic, (message: string): void => {
          if (airportId) {
            try {
              const parsed = JSON.parse(message) as AlertBroadcastMessage;
              if (parsed.alert?.airportId !== airportId) return;
            } catch {
              return;
            }
          }
          rawWs.send(message);
        });
        subscriptions.set(topic, unsubscribe);
      }
    },
    onClose(): void {
      for (const unsubscribe of subscriptions.values()) {
        void unsubscribe();
      }
      subscriptions.clear();
    },
  };
});
