import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribeToTopic } from "./service";

const HEARTBEAT_INTERVAL_MS = 15_000;

export const sseHandler = (c: Context): Response => {
  const topic = c.req.param("topic");
  if (!topic) {
    return new Response("Missing topic", { status: 400 });
  }

  return streamSSE(c, async (stream) => {
    let eventId = 0;
    let closed = false;

    const unsubscribe = subscribeToTopic(topic, async (message) => {
      if (closed) return;
      eventId += 1;
      await stream.writeSSE({
        id: String(eventId),
        event: "message",
        data: message,
      });
    });

    const heartbeat = setInterval(() => {
      if (closed) return;
      stream.writeSSE({ event: "heartbeat", data: "ping" }).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    const aborted = new Promise<void>((resolve) => {
      stream.onAbort(async () => {
        closed = true;
        clearInterval(heartbeat);
        await unsubscribe();
        resolve();
      });
    });

    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ topic }),
    });

    await aborted;
  });
};
