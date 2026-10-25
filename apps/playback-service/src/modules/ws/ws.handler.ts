import { logger } from "@repo/logger";
import { upgradeWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { redisSub, streamChannel } from "../../redis/client";
import type { PlaybackControlRequest } from "../schema/playback.schema";
import {
  applyControl,
  ensureEngine,
} from "../services/playback-engine.service";
import { getSessionRecord } from "../services/playback-session.service";

// One Redis subscription per open websocket connection, keyed by session id
// so we can unsubscribe cleanly on close instead of leaking listeners.
const listeners = new Map<string, (channel: string, message: string) => void>();

export const playbackWsHandlers = upgradeWebSocket((c) => {
  const sessionId = c.req.param("sessionId");
  if (!sessionId) {
    return Promise.reject(new Response("Missing sessionId", { status: 400 }));
  }

  return {
    onOpen: async (_evt: unknown, ws: WSContext) => {
      const session = await getSessionRecord(sessionId);
      if (!session) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `session ${sessionId} not found`,
          }),
        );
        ws.close();
        return;
      }

      const channel = streamChannel(sessionId);
      await redisSub.subscribe(channel);

      const listener = (incomingChannel: string, message: string) => {
        if (incomingChannel === channel) ws.send(message);
      };
      listeners.set(sessionId, listener);
      redisSub.on("message", listener);

      ws.send(JSON.stringify({ type: "session_state", data: session }));

      // Pre-warm the timeline in the background so an immediate `play`
      // doesn't wait on a full loadTimeline scan.
      ensureEngine(
        sessionId,
        session.airportId,
        new Date(session.from),
        new Date(session.to),
        session.fileId,
      ).catch((err) => logger.error("playback engine prime failed", err));
    },

    onMessage: async (evt: MessageEvent, ws: WSContext) => {
      try {
        const control = JSON.parse(String(evt.data)) as PlaybackControlRequest;
        await applyControl(sessionId, control);
        const session = await getSessionRecord(sessionId);
        ws.send(JSON.stringify({ type: "session_state", data: session }));
      } catch (err) {
        ws.send(
          JSON.stringify({ type: "error", message: (err as Error).message }),
        );
      }
    },

    onClose: async () => {
      const listener = listeners.get(sessionId);
      if (listener) {
        redisSub.off("message", listener);
        listeners.delete(sessionId);
      }
      await redisSub.unsubscribe(streamChannel(sessionId));
    },
  };
});
