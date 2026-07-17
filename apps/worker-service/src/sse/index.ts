import { EventEmitter } from "node:events";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

class EventBus extends EventEmitter {
  publish(topic: string, data: unknown): void {
    this.emit(topic, data);
  }

  subscribe(topic: string, listener: (data: unknown) => void): () => void {
    this.on(topic, listener);
    return (): this => this.off(topic, listener);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(0); // Remove the limit on the number of listeners

export const sseHandler = (c: Context): Response => {
  const topic = c.req.param("topic");
  if (!topic) {
    return new Response("Missing topic", { status: 400 });
  }

  return streamSSE(c, async (stream) => {
    let closed = false;

    const unsubscribe = eventBus.subscribe(topic, async (data) => {
      if (closed) return;

      await stream.writeSSE({
        data: JSON.stringify(data),
        event: topic,
        id: String(Date.now()),
      });
    });

    stream.onAbort(() => {
      closed = true;
      unsubscribe();
    });

    while (!closed) {
      await stream.sleep(15000); // Keep the connection alive
      if (closed) break;
      await stream.writeSSE({ event: "ping", data: "keep-alive" });
    }
  });
};

((): ReturnType<typeof setInterval> =>
  setInterval(
    () => eventBus.publish("current-time", { time: Date.now() }),
    1000,
  ))();
