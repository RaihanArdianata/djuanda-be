import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import type { ServerWebSocket } from "bun";
import { app } from "./app";
import { isValidAeroToken, surveillanceConfig } from "./config/surveillance";
import { isValidMonitorToken } from "./modules/history/service/history.service";
import {
  type ReplaySocketData,
  replayWebsocketHandlers,
} from "./modules/history/service/replay-socket";
import {
  flush,
  isValidIngestSecret,
} from "./modules/ingest/service/ingest.service";
import {
  startIngestKafkaConsumer,
  stopIngestKafkaConsumer,
} from "./modules/ingest/service/ingest-kafka-consumer";
import { handleIngestSocketMessage } from "./modules/ingest/service/ingest-socket";
import {
  startTrackProducer,
  stopTrackProducer,
} from "./modules/ingest/service/track.producer";
import {
  startMovementProducer,
  stopMovementProducer,
} from "./modules/messaging/movement.producer";
import {
  liveWebsocketHandlers,
  startSurveillance,
  stopSurveillance,
} from "./modules/surveillance/service/surveillance.service";

const port: string | number = process.env.CONNECTION_SERVICE_PORT || 3005;

type SocketData =
  | ({ kind: "replay" } & ReplaySocketData)
  | { kind: "ingest" }
  | { kind: "live"; token: string | null };

const asReplaySocket = (
  ws: ServerWebSocket<SocketData>,
): ServerWebSocket<ReplaySocketData> =>
  ws as unknown as ServerWebSocket<ReplaySocketData>;

const asLiveSocket = (
  ws: ServerWebSocket<SocketData>,
): ServerWebSocket<{ kind: "live"; token: string | null }> =>
  ws as unknown as ServerWebSocket<{ kind: "live"; token: string | null }>;

const server = Bun.serve<SocketData>({
  hostname: surveillanceConfig.httpHost,
  port: surveillanceConfig.httpPort || port,
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: route dispatch covers three established WebSocket protocols
  fetch(
    req: Request,
    srv: Bun.Server<SocketData>,
  ): Response | Promise<Response> | undefined {
    const url = new URL(req.url);
    if (url.pathname === "/aero/replay") {
      const token = url.searchParams.get("token");
      if (!isValidMonitorToken(token)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const upgraded = srv.upgrade(req, {
        data: {
          kind: "replay" as const,
          sessionId: url.searchParams.get("sessionId") ?? undefined,
        },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    if (url.pathname === "/aero/ingest/ws") {
      if (!isValidIngestSecret(url.searchParams.get("secret"))) {
        return new Response("Unauthorized", { status: 401 });
      }
      const upgraded = srv.upgrade(req, { data: { kind: "ingest" as const } });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    if (url.pathname === "/ws/tracks/live") {
      if (!isValidAeroToken(url.searchParams.get("token"))) {
        return new Response("Unauthorized", { status: 401 });
      }
      const upgraded = srv.upgrade(req, {
        data: { kind: "live" as const, token: url.searchParams.get("token") },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws: ServerWebSocket<SocketData>): void {
      if (ws.data.kind === "replay")
        replayWebsocketHandlers.open(asReplaySocket(ws));
      else if (ws.data.kind === "live")
        liveWebsocketHandlers.open(asLiveSocket(ws), ws.data.token);
    },
    message(
      ws: ServerWebSocket<SocketData>,
      raw: string | Buffer<ArrayBuffer>,
    ): void {
      if (ws.data.kind === "replay")
        replayWebsocketHandlers.message(asReplaySocket(ws), raw);
      else if (ws.data.kind === "live")
        liveWebsocketHandlers.message(asLiveSocket(ws), raw);
      else handleIngestSocketMessage(raw, ws);
    },
    close(ws: ServerWebSocket<SocketData>): void {
      if (ws.data.kind === "replay")
        replayWebsocketHandlers.close(asReplaySocket(ws));
      else if (ws.data.kind === "live")
        liveWebsocketHandlers.close(asLiveSocket(ws));
    },
  },
});

logger.info(`connection-service listening on http://localhost:${port}`);

startSurveillance();

startIngestKafkaConsumer().catch((err) => {
  logger.error(
    { err },
    "kafka ingest consumer failed to start — http/websocket ingest are unaffected",
  );
});

startTrackProducer().catch((err) => {
  logger.error(
    { err },
    "track producer failed to start — alerts will not receive asmgcs.tracks",
  );
});
startMovementProducer().catch((err) => {
  logger.error(
    { err },
    "movement producer failed to start — movement persistence is unaffected, realtime broadcast will be skipped",
  );
});

const shutdown = async (signal: string): Promise<never> => {
  logger.info(
    `${signal} received, shutting down connection-service gracefully`,
  );
  server.stop();
  await stopSurveillance();
  await stopIngestKafkaConsumer();
  await stopMovementProducer();
  await flush();
  await stopTrackProducer();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
