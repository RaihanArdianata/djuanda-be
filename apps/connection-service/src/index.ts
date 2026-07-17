import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import { app } from "./app";
import { isValidMonitorToken } from "./modules/history/service/history.service";
import {
  type ReplaySocketData,
  replayWebsocketHandlers,
} from "./modules/history/service/replay-socket";
import { flush } from "./modules/ingest/service/ingest.service";

const port: string | number = process.env.CONNECTION_SERVICE_PORT || 3005;

const server = Bun.serve<ReplaySocketData>({
  port,
  fetch(req, srv) {
    // WS replay lives outside Hono — Bun.serve owns the upgrade. Everything
    // else (REST history, ingest, health, metrics) goes through the app.
    const url = new URL(req.url);
    if (url.pathname === "/aero/replay") {
      const token = url.searchParams.get("token");
      if (!isValidMonitorToken(token)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const upgraded = srv.upgrade(req, {
        data: { sessionId: url.searchParams.get("sessionId") ?? undefined },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: replayWebsocketHandlers,
});

logger.info(`connection-service listening on http://localhost:${port}`);

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down connection-service gracefully`);
  server.stop();
  await flush();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
