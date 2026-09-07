import type { Alert } from "@repo/database";
import { catchAsync } from "@repo/shared/catch-async";
import { subscribeToTopic } from "@repo/shared/sse/publisher";

interface AlertBroadcastMessage {
  eventType: string;
  timestamp: string;
  alert: Alert;
}

export const alertStreamController = catchAsync(async (c) => {
  const airportId = c.req.query("airportId") ?? undefined;
  const topics = c.req.query("topics")?.split(",").filter(Boolean);
  const topicsSet = topics ? new Set(topics) : undefined;

  let cleanup: () => void = () => {};
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      const onMessage = (message: string): void => {
        try {
          const parsed = JSON.parse(message) as AlertBroadcastMessage;
          if (airportId && parsed.alert.airportId !== airportId) {
            return;
          }
          if (topicsSet && !topicsSet.has(parsed.eventType)) {
            return;
          }
          controller.enqueue(encoder.encode(`data: ${message}\n\n`));
        } catch {
          // skip malformed broadcast
        }
      };

      const remove = subscribeToTopic("alerts", onMessage);

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup();
        }
      }, 30000);

      cleanup = () => {
        clearInterval(heartbeat);
        void remove();
      };
    },
    cancel(): void {
      cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      connection: "keep-alive",
    },
  });
});
