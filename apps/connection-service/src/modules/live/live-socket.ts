import type { LiveServer } from "@aeroswarm/live-server";
import type { ServerWebSocket } from "bun";

/** Path AeroSwarm clients (`@aeroswarm/client`) connect to. */
export const LIVE_WS_PATH = "/ws/tracks/live";

export interface LiveSocketData {
  kind: "live";
  /** `token` query parameter, read once at upgrade time. */
  token: string | null;
}

/** The part of `Bun.Server` this needs, so it can be tested without a server. */
interface Upgrader {
  upgrade(req: Request, options: { data: LiveSocketData }): boolean;
}

/**
 * Handles a request for the live WebSocket path. Returns `null` when the path
 * is not ours (caller carries on routing), `undefined` when the upgrade
 * succeeded (Bun then owns the response), or a 400 `Response`.
 *
 * A missing or wrong token is *not* rejected here: the upgrade completes and
 * the socket is closed with 4001 / 4003, so the client's `onclose` carries the
 * reason instead of an opaque HTTP failure.
 */
export function upgradeLive(
  req: Request,
  srv: Upgrader,
): Response | undefined | null {
  const url = new URL(req.url);
  if (url.pathname !== LIVE_WS_PATH) return null;
  const token = url.searchParams.get("token");
  if (srv.upgrade(req, { data: { kind: "live", token } })) return undefined;
  return new Response("WebSocket upgrade failed", { status: 400 });
}

/** Bun `websocket` handlers for sockets whose `data.kind` is "live". */
export function liveSocketHandlers(live: LiveServer): {
  open(ws: ServerWebSocket<LiveSocketData>): void;
  message(ws: ServerWebSocket<LiveSocketData>, raw: string | Buffer): void;
  close(ws: ServerWebSocket<LiveSocketData>): void;
} {
  return {
    open(ws: ServerWebSocket<LiveSocketData>): void {
      void live.handlers.open(ws, { token: ws.data.token });
    },
    message(ws: ServerWebSocket<LiveSocketData>, raw: string | Buffer): void {
      live.handlers.message(ws, raw);
    },
    close(ws: ServerWebSocket<LiveSocketData>): void {
      live.handlers.close(ws);
    },
  };
}
