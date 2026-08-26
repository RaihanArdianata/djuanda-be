import { catchAsync } from "@repo/shared";
import { addStreamClient } from "../service/alert-broadcast.service";

export const alertStreamController = catchAsync(async (c) => {
  const airportId = c.req.query("airportId") ?? undefined;
  const topics = c.req.query("topics")?.split(",").filter(Boolean);

  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller: ReadableStreamDefaultController<Uint8Array>): void {
      const client = {
        controller,
        airportId,
        topics: topics ? new Set(topics) : undefined,
      };

      const remove = addStreamClient(client);
      const encoder = new TextEncoder();

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":\n\n"));
        } catch {
          cleanup();
        }
      }, 30000);

      cleanup = () => {
        clearInterval(heartbeat);
        remove();
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
