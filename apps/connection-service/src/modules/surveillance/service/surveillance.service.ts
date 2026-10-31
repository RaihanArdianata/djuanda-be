import { toCurrentTrack } from "@aeroswarm/core/utils";
import { currentTrackSchema } from "@aeroswarm/core/validation";
import {
  AftnFeedSource,
  AsterixFeedSource,
  type IngestEvent,
} from "@aeroswarm/ingest";
import {
  createFlightPlanStore,
  createLiveServer,
  createTrackState,
} from "@aeroswarm/live-server";
import {
  aeroswarmFlightplans,
  aeroswarmSourceHealth,
  db,
} from "@repo/database";
import { logger } from "@repo/logger";
import type { ServerWebSocket } from "bun";
import { surveillanceConfig } from "../../../config/surveillance";
import {
  enqueueTrackEvent,
  type FusedTrackEventLike,
} from "../../ingest/service/ingest.service";
import {
  closeConnectors,
  connectorState,
  flushConnectors,
  sendToConnectors,
} from "../connectors";
import { surveillanceMetrics, websocketClients } from "../metrics";

type LiveSocket = {
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
  getBufferedAmount?: () => number;
};

type LiveData = { kind: "live" };

const plans = createFlightPlanStore();
const state = createTrackState({
  removeAfterMs: 10 * 60_000,
  attachFlightPlan: plans.attach,
});
const live = createLiveServer({
  state,
  defaultUpdateHz: 10,
  heartbeatMs: 15_000,
  authenticate: (token: string) =>
    token === surveillanceConfig.token
      ? { airportId: surveillanceConfig.airportId }
      : null,
  logger: {
    info: (obj: unknown, msg?: string) =>
      logger.info({ ...asLogObject(obj) }, msg),
    warn: (obj: unknown, msg?: string) =>
      logger.warn({ ...asLogObject(obj) }, msg),
    error: (obj: unknown, msg?: string) =>
      logger.error({ ...asLogObject(obj) }, msg),
  },
});

let source: AsterixFeedSource | null = null;
let aftn: AftnFeedSource | null = null;
let pendingWrites = Promise.resolve();
let pendingConnectors = Promise.resolve();

function queueWrite(operation: () => Promise<void>): void {
  pendingWrites = pendingWrites.then(operation).catch((error) => {
    surveillanceMetrics.dbWriteErrors.inc();
    logger.error({ err: error }, "surveillance write failed");
  });
}

function queueConnector(event: unknown): void {
  pendingConnectors = pendingConnectors
    .then(() => sendToConnectors(event))
    .catch((error) => {
      logger.error({ err: error }, "surveillance connector failed");
    });
}

function asLogObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : { detail: value };
}

function handleEvent(event: IngestEvent): void {
  if (event.kind === "track") {
    if (!("position" in event.event) || event.event.lifecycle === "dropped") {
      return;
    }
    const track = event.event;
    surveillanceMetrics.asterixPacketsReceived.inc();
    const validation = currentTrackSchema.safeParse(toCurrentTrack(track));
    if (!validation.success) {
      live.degraded("track validation failed", surveillanceConfig.sourceId);
      return;
    }
    state.ingest(track);
    surveillanceMetrics.asterixTracksDecoded.inc();
    queueConnector(track);
    queueWrite(async () => {
      await enqueueTrackEvent(track as unknown as FusedTrackEventLike, {
        awaitFlush: true,
      });
      surveillanceMetrics.asterixTracksPersisted.inc();
    });
    return;
  }

  if (event.kind === "flightplan") {
    surveillanceMetrics.aftnMessagesReceived.inc();
    queueConnector(event.event);
    const plan = plans.apply(event.event);
    if (plan) {
      state.refreshFlightPlans((track) => plans.matches(plan, track));
      queueWrite(async () => {
        await db
          .insert(aeroswarmFlightplans)
          .values({
            updatedAt: new Date(plan.updatedAt),
            planId: plan.id,
            airportId: plan.airportId ?? surveillanceConfig.airportId,
            data: plan,
          })
          .onConflictDoUpdate({
            target: aeroswarmFlightplans.planId,
            set: {
              updatedAt: new Date(plan.updatedAt),
              airportId: plan.airportId ?? surveillanceConfig.airportId,
              data: plan,
            },
          });
        surveillanceMetrics.aftnFlightplansPersisted.inc();
      });
    }
    return;
  }

  if (event.kind === "health") {
    surveillanceMetrics.sourceHealthEvents.inc();
    queueConnector(event.event);
    live.sourceStatus(event.event.sourceId, event.event.status);
    queueWrite(async () => {
      await db.insert(aeroswarmSourceHealth).values({
        observedAt: new Date(event.event.timestamp),
        sourceId: event.event.sourceId,
        airportId: surveillanceConfig.airportId,
        status: event.event.status,
        data: event.event,
      });
    });
    return;
  }

  if (event.kind === "status") {
    live.degraded(event.reason || event.status, surveillanceConfig.sourceId);
  }
}

export function startSurveillance(): void {
  if (source) return;

  state.startSweep();
  plans.startSweep();
  source = new AsterixFeedSource({
    transport: surveillanceConfig.sourceTransport as "udp" | "tcp",
    port: surveillanceConfig.sourcePort,
    bindHost: surveillanceConfig.sourceBindHost,
    airportId: surveillanceConfig.airportId,
    sourceId: surveillanceConfig.sourceId,
    multicastGroup: surveillanceConfig.sourceMulticastGroup,
    multicastIface: surveillanceConfig.sourceMulticastIface,
  });
  source.start(handleEvent);

  if (surveillanceConfig.aftnEnabled) {
    aftn = new AftnFeedSource({
      transport: surveillanceConfig.aftnTransport as "udp" | "tcp",
      port: surveillanceConfig.aftnPort,
      airportId: surveillanceConfig.airportId,
      sourceId: surveillanceConfig.aftnSourceId,
    });
    aftn.start(handleEvent);
  }
}

export async function stopSurveillance(): Promise<void> {
  state.stopSweep();
  plans.stopSweep();
  live.stop();
  await Promise.all([source?.stop(), aftn?.stop()]);
  await pendingWrites;
  await pendingConnectors;
  await flushConnectors();
  await closeConnectors();
  source = null;
  aftn = null;
}

export function getSurveillanceState(): {
  source: unknown;
  aftn: unknown;
  live: ReturnType<typeof live.stats>;
  tracks: number;
  flightplans: number;
  connectorErrors: number;
} {
  return {
    source: source?.stats ?? null,
    aftn: aftn?.stats ?? null,
    live: live.stats(),
    tracks: state.size,
    flightplans: plans.size,
    connectorErrors: connectorState().errors,
  };
}

export const liveWebsocketHandlers = {
  open(ws: ServerWebSocket<LiveData>, token: string | null): void {
    websocketClients.inc();
    void live.handlers.open(ws as unknown as LiveSocket, { token });
  },
  message(ws: ServerWebSocket<LiveData>, raw: string | Buffer): void {
    live.handlers.message(ws as unknown as LiveSocket, raw.toString());
  },
  close(ws: ServerWebSocket<LiveData>): void {
    websocketClients.dec();
    live.handlers.close(ws as unknown as LiveSocket);
  },
};
