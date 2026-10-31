import type {
  FlightPlanEvent,
  FusedTrackEvent,
  SourceHealthEvent,
} from "@aeroswarm/core";
import {
  createTrackFuser,
  type MovementEvent,
  type TrackFuser,
} from "@aeroswarm/live-server";
import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import type { ServerWebSocket } from "bun";
import { app } from "./app";
import { verifyToken } from "./modules/auth/token";
import { startAftnFeeds, stopAftnFeeds } from "./modules/feed/aftn-feed";
import {
  getFeedStates,
  startAsterixFeeds,
  stopAsterixFeeds,
} from "./modules/feed/asterix-feed";
import { feedMetrics, registerStatMetrics } from "./modules/feed/feed-metrics";
import { flightPlanPublisherFromEnv } from "./modules/flightplan/flightplan.producer";
import { restoreFlightPlans } from "./modules/flightplan/flightplan-restore";
import { fetchStoredFlightPlanEvents } from "./modules/flightplan/flightplan-restore.db";
import { fusionConfigFromEnv } from "./modules/fusion/fusion-config";
import { isValidMonitorToken } from "./modules/history/service/history.service";
import {
  type ReplaySocketData,
  replayWebsocketHandlers,
} from "./modules/history/service/replay-socket";
import {
  enqueueMovementEvent,
  enqueueTrackEvent,
  type FusedTrackEventLike,
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
import { createLiveRuntime } from "./modules/live/live-runtime";
import {
  type LiveSocketData,
  liveSocketHandlers,
  upgradeLive,
} from "./modules/live/live-socket";
import {
  startMovementProducer,
  stopMovementProducer,
} from "./modules/messaging/movement.producer";
import {
  createMovementRecorder,
  toMovementIngestEvent,
} from "./modules/movement/movement-recorder";
import { registerHealthProbe } from "./routes/health";

const port: string | number = process.env.CONNECTION_SERVICE_PORT || 3005;

type SocketData =
  | ({ kind: "replay" } & ReplaySocketData)
  | { kind: "ingest" }
  | LiveSocketData;

// The live picture (track state, flight plans, /ws/tracks/live). Built before
// the server so the websocket handlers below can reference it.
const liveRuntime = createLiveRuntime({
  authenticate: (token: string) => verifyToken(token),
});
const liveHandlers = liveSocketHandlers(liveRuntime.live);
const asLiveSocket = (
  ws: ServerWebSocket<SocketData>,
): ServerWebSocket<LiveSocketData> =>
  ws as unknown as ServerWebSocket<LiveSocketData>;

const asReplaySocket = (
  ws: ServerWebSocket<SocketData>,
): ServerWebSocket<ReplaySocketData> =>
  ws as unknown as ServerWebSocket<ReplaySocketData>;

const server = Bun.serve<SocketData>({
  port,
  fetch(
    req: Request,
    srv: Bun.Server<SocketData>,
  ): Response | Promise<Response> | undefined {
    const url = new URL(req.url);
    const live = upgradeLive(req, srv);
    if (live !== null) return live;
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
    return app.fetch(req);
  },
  websocket: {
    open(ws: ServerWebSocket<SocketData>): void {
      if (ws.data.kind === "replay")
        replayWebsocketHandlers.open(asReplaySocket(ws));
      else if (ws.data.kind === "live") liveHandlers.open(asLiveSocket(ws));
    },
    message(
      ws: ServerWebSocket<SocketData>,
      raw: string | Buffer<ArrayBuffer>,
    ): void {
      if (ws.data.kind === "replay")
        replayWebsocketHandlers.message(asReplaySocket(ws), raw);
      else if (ws.data.kind === "live")
        liveHandlers.message(asLiveSocket(ws), raw);
      else handleIngestSocketMessage(raw, ws);
    },
    close(ws: ServerWebSocket<SocketData>): void {
      if (ws.data.kind === "replay")
        replayWebsocketHandlers.close(asReplaySocket(ws));
      else if (ws.data.kind === "live") liveHandlers.close(asLiveSocket(ws));
    },
  },
});

logger.info(`connection-service listening on http://localhost:${port}`);

// Takeoffs and landings, detected from the same track stream and stored with
// the other ingest events (statistics-service reads them from there).
const movements = createMovementRecorder({
  onMovement: (event: MovementEvent): void => {
    void enqueueMovementEvent(toMovementIngestEvent(event), {
      awaitFlush: false,
    });
  },
});
movements.startSweep();

// Radar and MLAT often see the same aircraft; without this each feed's own
// track id would replace the other's on every update.
const fusionConfig = fusionConfigFromEnv(process.env);
for (const w of fusionConfig.warnings) logger.warn(w);
const fuser: TrackFuser | null = fusionConfig.enabled
  ? createTrackFuser(fusionConfig.options)
  : null;
const FUSION_SWEEP_MS = 30_000;
const fusionSweep = fuser
  ? setInterval(() => fuser.sweep(), FUSION_SWEEP_MS)
  : null;
logger.info(
  fuser ? fusionConfig.options : {},
  fuser
    ? "track fusion enabled"
    : "track fusion disabled (FUSION_ENABLED=false)",
);

liveRuntime.state.on("removed", ({ trackId }): void => {
  movements.forget(trackId);
  fuser?.forget(trackId);
});

// Flight plans: kept in memory for the live picture and forwarded to Kafka so
// advisory-service stores them (it reads the same topic AeroSwarm used to fill).
const flightPlanPublisher = flightPlanPublisherFromEnv(process.env);
const onFlightPlan = (event: FlightPlanEvent): void => {
  feedMetrics.aftnMessagesReceived.inc();
  liveRuntime.feedHandlers.onFlightPlan?.(event);
  flightPlanPublisher
    .publish(event)
    .then(() => feedMetrics.aftnFlightplansPersisted.inc())
    .catch((err: unknown) => {
      logger.warn({ err }, "flight plan not forwarded to Kafka");
    });
};

startAsterixFeeds({
  fuse: fuser ? (event: FusedTrackEvent) => fuser.ingest(event) : undefined,
  persist: (event: FusedTrackEventLike): void => {
    enqueueTrackEvent(event, { awaitFlush: false })
      .then(() => feedMetrics.tracksPersisted.inc())
      .catch((err: unknown) => {
        feedMetrics.dbWriteErrors.inc();
        logger.error({ err }, "track could not be queued for storage");
      });
  },
  // AFTN multiplexed onto the radar stream takes the same route as a dedicated AFTN feed.
  handlers: {
    ...liveRuntime.feedHandlers,
    onTrack: (event: FusedTrackEvent): void => {
      feedMetrics.tracksDecoded.inc();
      liveRuntime.feedHandlers.onTrack?.(event);
      movements.evaluate(event);
    },
    onHealth: (event: SourceHealthEvent): void => {
      feedMetrics.sourceHealthEvents.inc();
      liveRuntime.feedHandlers.onHealth?.(event);
    },
    onFlightPlan,
  },
});

// Numbers the packages already keep are read when Prometheus scrapes; the same
// state backs /health, so the two cannot disagree.
registerStatMetrics({
  feeds: () => getFeedStates().map((f) => f.stats),
  live: () => liveRuntime.live.stats(),
});
const DB_PROBE_TIMEOUT_MS = 2_000;
registerHealthProbe({
  feeds: getFeedStates,
  live: () => ({
    clients: liveRuntime.live.stats().clients,
    tracks: liveRuntime.state.size,
    flightplans: liveRuntime.plans.size,
  }),
  fusion: () => fuser?.stats() ?? null,
  database: async (): Promise<boolean> => {
    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), DB_PROBE_TIMEOUT_MS),
    );
    const ping = pool.query("select 1").then(() => true);
    return Promise.race([ping, timeout]);
  },
});

// Plans first, so tracks arriving meanwhile are matched as soon as the store is warm.
(async (): Promise<void> => {
  try {
    const restored = await restoreFlightPlans(
      liveRuntime.plans,
      fetchStoredFlightPlanEvents,
    );
    logger.info(restored, "flight plans restored from stored AFTN");
  } catch (err) {
    logger.warn(
      { err },
      "could not restore flight plans — labels stay white until new AFTN arrives",
    );
  }
  await flightPlanPublisher.start().catch((err: unknown) => {
    logger.error(
      { err },
      "flight plan producer failed to start — AFTN is not forwarded",
    );
  });
  startAftnFeeds({ onFlightPlan });
})();

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
  liveRuntime.stop();
  movements.stop();
  if (fusionSweep) clearInterval(fusionSweep);
  await stopAsterixFeeds();
  await stopAftnFeeds();
  await flightPlanPublisher.stop();
  await stopIngestKafkaConsumer();
  await stopMovementProducer();
  await flush();
  await stopTrackProducer();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
