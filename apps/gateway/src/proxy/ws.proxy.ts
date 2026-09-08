import type { ServerWebSocket } from "bun";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { services } from "@/config/services";

function toWsMessage(data: unknown): string | ArrayBuffer {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const buffer = data.buffer as ArrayBuffer;
    return buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return String(data);
}

export const wsProxy = upgradeWebSocket((c) => {
  const incomingUrl = new URL(c.req.url);
  const targetUrl = new URL(
    incomingUrl.pathname + incomingUrl.search,
    services.WS_SERVICE,
  )
    .toString()
    .replace(/^http/, "ws");

  let upstream: WebSocket | null = null;

  return {
    onOpen(_evt: Event, ws: WSContext): void {
      const rawWs = ws.raw as ServerWebSocket;
      upstream = new WebSocket(targetUrl);

      upstream.onopen = (): void => {
        // connected to upstream
      };

      upstream.onmessage = (evt: MessageEvent): void => {
        rawWs.send(toWsMessage(evt.data));
      };

      upstream.onclose = (evt: CloseEvent): void => {
        rawWs.close(evt.code, evt.reason);
      };

      upstream.onerror = (): void => {
        rawWs.close(1011, "upstream error");
      };
    },
    onMessage(evt: MessageEvent): void {
      if (!upstream) return;
      upstream.send(toWsMessage(evt.data));
    },
    onClose(_evt: CloseEvent): void {
      if (upstream) {
        upstream.close();
        upstream = null;
      }
    },
  };
});
