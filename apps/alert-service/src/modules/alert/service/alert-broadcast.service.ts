import type { Alert } from "@repo/database";

export interface StreamClient {
  controller: ReadableStreamDefaultController<Uint8Array>;
  airportId?: string;
  topics?: Set<string>;
}

const clients = new Set<StreamClient>();
const encoder = new TextEncoder();

export function addStreamClient(client: StreamClient): () => void {
  clients.add(client);

  return () => {
    clients.delete(client);
  };
}

export function broadcastAlert(alert: Alert, eventType: string): void {
  const payload = JSON.stringify({
    eventType,
    timestamp: new Date().toISOString(),
    alert,
  });
  const data = `data: ${payload}\n\n`;
  const bytes = encoder.encode(data);

  for (const client of clients) {
    if (client.airportId && client.airportId !== alert.airportId) {
      continue;
    }

    if (client.topics && !client.topics.has(eventType)) {
      continue;
    }

    try {
      client.controller.enqueue(bytes);
    } catch {
      clients.delete(client);
    }
  }
}
