import type {
  FlightPlanEvent,
  FusedTrackEvent,
  SourceHealthEvent,
} from "@aeroswarm/core";
import {
  createFlightPlanStore,
  createLiveServer,
  createTrackState,
  type FlightPlanStore,
  type LiveAuth,
  type LiveServer,
  type TrackState,
} from "@aeroswarm/live-server";
import { logger } from "@repo/logger";
import type { FeedHandlers } from "../feed/asterix-feed";
import { type LiveConfig, liveConfigFromEnv } from "./live-config";

export interface LiveRuntime {
  /** Live picture: lifecycle, de-duplication, flight-plan attachment. */
  state: TrackState;
  /** AFTN flight plans, correlated to tracks. */
  plans: FlightPlanStore;
  /** WebSocket handlers speaking the AeroSwarm envelope protocol. */
  live: LiveServer;
  /** Feed callbacks that drive the runtime — pass as `startAsterixFeeds({ handlers })`. */
  feedHandlers: FeedHandlers;
  /** Stop timers and close every client socket. */
  stop(): void;
}

export interface LiveRuntimeOptions {
  /** Returns the grant for a valid token, null to reject. */
  authenticate: (token: string) => LiveAuth | null;
  config?: LiveConfig;
}

/**
 * Wires the live picture together:
 *
 *   feed track  ──► state.ingest ──► (deltas) ──► every subscribed WebSocket
 *   feed AFTN   ──► plans.apply  ──► state.refreshFlightPlans (plan reaches
 *                                    tracks already on screen)
 *   feed health ──► live.sourceStatus
 *
 * `state.sweep` runs on a timer, which is what turns silent tracks stale and
 * lost; without it they would stay "active" forever.
 */
export function createLiveRuntime(opts: LiveRuntimeOptions): LiveRuntime {
  const config = opts.config ?? liveConfigFromEnv(process.env);
  for (const w of config.warnings) logger.warn(w);

  const plans = createFlightPlanStore();
  const state = createTrackState({
    staleAfterMs: config.staleAfterMs,
    lostAfterMs: config.lostAfterMs,
    removeAfterMs: config.removeAfterMs,
    interestBbox: config.interestBbox,
    interestLookaheadMin: config.interestLookaheadMin,
    exit: config.exit,
    attachFlightPlan: plans.attach,
  });
  if (config.interestBbox) {
    logger.info(
      {
        bbox: config.interestBbox,
        lookaheadMin: config.interestLookaheadMin ?? 90,
        exit: config.exit.enabled,
      },
      "live picture limited to the interest zone",
    );
  }
  plans.on("changed", (plan) => {
    state.refreshFlightPlans((track) => plans.matches(plan, track));
  });

  const live = createLiveServer({
    state,
    authenticate: opts.authenticate,
    defaultUpdateHz: config.defaultUpdateHz,
    heartbeatMs: config.heartbeatMs,
    logger: {
      info: (obj: unknown, msg?: string): void => {
        logger.info(obj as object, msg);
      },
      warn: (obj: unknown, msg?: string): void => {
        logger.warn(obj as object, msg);
      },
      error: (obj: unknown, msg?: string): void => {
        logger.error(obj as object, msg);
      },
    },
  });

  state.startSweep(config.sweepMs);
  plans.startSweep();

  return {
    state,
    plans,
    live,
    feedHandlers: {
      onTrack: (event: FusedTrackEvent): void => {
        state.ingest(event);
      },
      onHealth: (event: SourceHealthEvent): void => {
        live.sourceStatus(event.sourceId, event.status);
      },
      onFlightPlan: (event: FlightPlanEvent): void => {
        plans.apply(event);
      },
    },
    stop(): void {
      live.stop();
      state.stopSweep();
      plans.stopSweep();
    },
  };
}
