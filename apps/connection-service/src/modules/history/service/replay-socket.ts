import { ReplaySession } from "@aeroswarm/replay-server";
import type { ServerWebSocket } from "bun";
import {
  nextSeq,
  replayCheckpoints,
  replayStore,
} from "./history.service";

// @aeroswarm/replay-server's own attachWebSocket() targets a Node
// http.Server ("upgrade" events + the ws package) — Bun.serve has native
// WebSocket support instead, so this file wires ReplaySession (a public
// export of the package) to Bun's socket handlers directly. ReplaySession
// only ever calls socket.send(), which Bun's ServerWebSocket provides.

export interface ReplaySocketData {
  sessionId?: string;
  session?: ReplaySession;
}

type ReplaySessionSocket = ConstructorParameters<typeof ReplaySession>[0];

export const replayWebsocketHandlers = {
  open(ws: ServerWebSocket<ReplaySocketData>): void {
    const session = new ReplaySession(
      ws as unknown as ReplaySessionSocket,
      replayStore,
      replayCheckpoints,
      nextSeq,
      ws.data.sessionId,
    );
    ws.data.session = session;
    if (ws.data.sessionId) {
      session.loadAndResume().catch(() => null);
    }
  },

  message(ws: ServerWebSocket<ReplaySocketData>, raw: string | Buffer): void {
    const session = ws.data.session;
    if (!session) return;
    try {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      const type = msg.type;
      if (type === "replay.start") {
        const speed = typeof msg.speed === "number" ? msg.speed : 1;
        session
          .start(new Date(msg.from as string), new Date(msg.to as string), speed)
          .catch(() => null);
      } else if (type === "replay.pause") session.pause();
      else if (type === "replay.resume") session.resume();
      else if (type === "replay.seek") session.seek(new Date(msg.at as string));
      else if (type === "replay.stop") session.stop();
    } catch {
      // malformed client message — ignore, same policy as AeroSwarm's WS layer
    }
  },

  close(ws: ServerWebSocket<ReplaySocketData>): void {
    ws.data.session?.stop();
  },
};
