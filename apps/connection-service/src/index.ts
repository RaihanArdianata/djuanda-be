import type {
  FlightPlanEvent,
  FusedTrackEvent,
  SourceHealthEvent,
} from "@aeroswarm/core";
import {
  createTrackFuser,
  createTrailStore,
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
import { createIdentityMemory } from "./modules/feed/identity-memory";
import { restoreIdentities } from "./modules/feed/identity-restore";
import { fetchStoredIdentities } from "./modules/feed/identity-restore.db";
import {
  applySurfaceState,
  createSurfaceStateStore,
} from "./modules/feed/surface-state";
import { flightPlanPublisherFromEnv } from "./modules/flightplan/flightplan.producer";
import { restoreFlightPlans } from "./modules/flightplan/flightplan-restore";
import { fetchStoredFlightPlanEvents } from "./modules/flightplan/flightplan-restore.db";
import { callsignFromPlan } from "./modules/flightplan/plan-callsign";
import { fusionConfigFromEnv } from "./modules/fusion/fusion-config";
import {
  isValidMonitorToken,
  replayStore,
} from "./modules/history/service/history.service";
import {
  type ReplaySocketData,
  replayWebsocketHandlers,
} from "./modules/history/service/replay-socket";
import {
  createPrimaryFeedGate,
  dedupeWindowFromEnv,
} from "./modules/ingest/lib/primary-feed-gate";
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
import {
  type InterestTarget,
  startInterestSync,
} from "./modules/live/interest-area";
import { fetchAreaRule } from "./modules/live/interest-area.db";
import { liveConfigFromEnv } from "./modules/live/live-config";
import { createLiveRuntime } from "./modules/live/live-runtime";
import {
  type LiveSocketData,
  liveSocketHandlers,
  upgradeLive,
} from "./modules/live/live-socket";
import { createMovementPhaseStore } from "./modules/live/movement-phase";
import {
  startMovementProducer,
  stopMovementProducer,
} from "./modules/messaging/movement.producer";
import {
  createMovementRecorder,
  toMovementIngestEvent,
} from "./modules/movement/movement-recorder";
import { registerTrailRoute } from "./modules/trail/trail.route";
import { trailConfigFromEnv } from "./modules/trail/trail-config";
import { registerTrailStatMetrics } from "./modules/trail/trail-metrics";
import { createTrailService } from "./modules/trail/trail-service";
import { registerHealthProbe } from "./routes/health";

const port: string | number = process.env.CONNECTION_SERVICE_PORT || 3005;

type SocketData =
  | ({ kind: "replay" } & ReplaySocketData)
  | { kind: "ingest" }
  | LiveSocketData;

// The live picture (track state, flight plans, /ws/tracks/live). Built before
// the server so the websocket handlers below can reference it.
// Takeoff/landing terakhir tiap track; menentukan Arrival/Departure di label, dengan atau
// tanpa rencana penerbangan (AFTN).
const movementPhases = createMovementPhaseStore();
// Satu keputusan darat/udara untuk peta, alert, dan statistik (flag feed saja tidak cukup).
const surfaceStates = createSurfaceStateStore();
const liveRuntime = createLiveRuntime({
  authenticate: (token: string) => verifyToken(token),
  movementPhases,
  surfaceStates,
});
// Area peminat track dari profil bandara (aturan ALERT_AREA di halaman aturan alert): menggantikan INTEREST_BBOX dan berubah
// tanpa restart. Tanpa aturan atau tanpa interestRadiusNm, INTEREST_BBOX dari env tetap berlaku.
const interestAirportId: string = process.env.AEROSWARM_AIRPORT_ID ?? "WARR";
const stopInterestSync: () => void = startInterestSync({
  // setInterest existe di @aeroswarm/live-server yang lebih baru; versi lama dilewati dengan peringatan.
  target: liveRuntime.state as unknown as InterestTarget,
  fallback: liveConfigFromEnv(process.env).interestBbox,
  fetchRule: () => fetchAreaRule(interestAirportId),
  log: logger,
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
    movementPhases.set(event.trackId, event.type);
    // Dorong fase baru ke klien sekarang, tanpa menunggu update radar berikutnya.
    liveRuntime.state.refreshFlightPlans(
      (track) => track.trackId === event.trackId,
    );
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

// The line behind each aircraft, kept in memory as the live picture changes, so
// answering a trail request is a read and costs the feeds nothing.
const trailConfig = trailConfigFromEnv(process.env);
for (const w of trailConfig.warnings) logger.warn(w);
const trail = trailConfig.enabled ? createTrailStore(trailConfig.store) : null;
if (trail) {
  trail.attach(liveRuntime.state);
  trail.startSweep();
  registerTrailStatMetrics(trail);
  registerTrailRoute({
    authenticate: (token: string | null): boolean =>
      verifyToken(token) !== null,
    service: createTrailService({
      trail,
      history: trailConfig.dbFallback ? replayStore : undefined,
      icao24Of: (id: string): string | undefined =>
        liveRuntime.state.get(id)?.icao24 ?? undefined,
      minDistanceM: trailConfig.store.minDistanceM ?? 100,
      backfillMs: trailConfig.backfillMs,
      startedAt: Date.now(),
    }),
    labelEveryMs: trailConfig.labelEveryMs,
    defaultLimit: trailConfig.defaultLimit,
  });
}
logger.info(
  trail ? { ...trailConfig.store, dbFallback: trailConfig.dbFallback } : {},
  trail ? "trails enabled" : "trails disabled (TRAIL_ENABLED=false)",
);

liveRuntime.state.on("removed", ({ trackId }): void => {
  movements.forget(trackId);
  movementPhases.forget(trackId);
  surfaceStates.forget(trackId);
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

// Feed UDP langsung adalah jalur utama; topic Kafka AeroSwarm (data yang sama) hanya cadangan.
const primaryFeedGate = createPrimaryFeedGate(dedupeWindowFromEnv(process.env));
let lastDuplicatesDropped = 0;
setInterval(() => {
  primaryFeedGate.sweep();
  const stats = primaryFeedGate.stats();
  if (stats.dropped !== lastDuplicatesDropped) {
    lastDuplicatesDropped = stats.dropped;
    logger.info(stats, "kafka ingest: duplicates of the direct feed dropped");
  }
}, 60_000).unref?.();

// ASTERIX menyertakan callsign hanya sesekali; ingat yang terakhir supaya update tanpa identitas
// tidak menimpanya (label kembali ke kode Mode-S, termasuk saat track lost).
// Pesawat yang belum pernah mengirim identitas diberi nama dari rencana AFTN yang memuat alamat
// Mode-S-nya; saat start, callsign 30 menit terakhir dipulihkan dari database.
const identityMemory = createIdentityMemory({
  fallback: (icao24: string, now: number): string | undefined =>
    callsignFromPlan(liveRuntime.plans, icao24, now),
});
restoreIdentities(identityMemory, fetchStoredIdentities)
  .then((restored) =>
    logger.info(restored, "aircraft callsigns restored from stored tracks"),
  )
  .catch((err: unknown) =>
    logger.warn(
      { err },
      "could not restore aircraft callsigns — names fill in as identities arrive",
    ),
  );
setInterval(() => identityMemory.sweep(), 60_000).unref?.();

startAsterixFeeds({
  fuse: (event: FusedTrackEvent): FusedTrackEvent | null => {
    const normalized = applySurfaceState(identityMemory.fill(event));
    const out = fuser ? fuser.ingest(normalized) : normalized;
    if (out && out.lifecycle !== "dropped") {
      surfaceStates.set(out.trackId, out.position?.onGround);
    }
    return out;
  },
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
      primaryFeedGate.seen(event.identity?.icao24);
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
  trail: () => trail?.stats() ?? null,
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

startIngestKafkaConsumer({ gate: primaryFeedGate }).catch((err) => {
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
  stopInterestSync();
  liveRuntime.stop();
  movements.stop();
  if (fusionSweep) clearInterval(fusionSweep);
  trail?.stopSweep();
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
