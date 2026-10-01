import type { Alert } from "@repo/database";
import { catchAsync } from "@repo/shared/catch-async";
import { subscribeToTopic } from "@repo/shared/sse/publisher";

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 3_000;

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
      // Flush header + set delay reconnect klien, supaya EventSource langsung
      // "open" walau belum ada alert.
      controller.enqueue(
        encoder.encode(`retry: ${RECONNECT_DELAY_MS}\n\n: connected\n\n`),
      );

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
      }, HEARTBEAT_INTERVAL_MS);

      // Idempoten: dipanggil dari heartbeat gagal DAN cancel() saat disconnect.
      let closed = false;
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        Promise.resolve(remove()).catch(() => {});
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
      "Cache-Control": "no-cache, no-transform",
      connection: "keep-alive",
      // Cegah reverse proxy (nginx) mem-buffer stream.
      "X-Accel-Buffering": "no",
    },
  });
});
