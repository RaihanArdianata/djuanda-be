import type { ServerWebSocket } from "bun";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";

/** Where the live track stream really is. Compose sets it to the connection-service container. */
export const connectionServiceUrl = (): string =>
  process.env.CONNECTION_SERVICE_URL || "http://connection-service:3005";

/** The same path and query (the token) on connection-service, as a ws:// URL. */
export function liveTargetUrl(requestUrl: string, base: string): string {
  const incoming = new URL(requestUrl);
  return new URL(incoming.pathname + incoming.search, base)
    .toString()
    .replace(/^http/, "ws");
}

function toWsMessage(data: unknown): string | ArrayBuffer {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const buffer = data.buffer as ArrayBuffer;
    return buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return String(data);
}

/** Close codes 1005/1006/1015 describe a connection and cannot be sent in a close frame. */
const closeCodeFor = (code: number): number =>
  code === 1005 || code === 1006 || code === 1015 || code < 1000 ? 1000 : code;

/**
 * `/ws/tracks/live` for browsers: the stream is produced by connection-service, but WebSocket traffic
 * reaches the backend through worker-service (like playback), so this relays frames both ways. The
 * token travels in the query string and is checked by connection-service, not here.
 */
export const connectionLiveProxy = upgradeWebSocket((c) => {
  const target = liveTargetUrl(c.req.url, connectionServiceUrl());
  let upstream: WebSocket | null = null;
  const pending: (string | ArrayBuffer)[] = [];

  return {
    onOpen(_evt: Event, ws: WSContext): void {
      const client = ws.raw as ServerWebSocket;
      upstream = new WebSocket(target);
      upstream.onopen = (): void => {
        while (upstream && pending.length > 0) {
          upstream.send(pending.shift() as string | ArrayBuffer);
        }
      };
      upstream.onmessage = (evt: MessageEvent): void => {
        client.send(toWsMessage(evt.data));
      };
      upstream.onclose = (evt: CloseEvent): void => {
        client.close(closeCodeFor(evt.code), evt.reason);
      };
      upstream.onerror = (): void => {
        client.close(1011, "live stream unavailable");
      };
    },
    onMessage(evt: MessageEvent): void {
      if (!upstream) return;
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(toWsMessage(evt.data));
      } else {
        pending.push(toWsMessage(evt.data));
      }
    },
    onClose(): void {
      upstream?.close();
      upstream = null;
    },
  };
});
