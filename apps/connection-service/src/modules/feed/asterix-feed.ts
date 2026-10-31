import type {
  FlightPlanEvent,
  FusedTrackEvent,
  SourceHealthEvent,
} from "@aeroswarm/core";
import {
  createFeedSource,
  type IngestEvent,
  type IngestSourceStats,
} from "@aeroswarm/ingest";
import { logger } from "@repo/logger";
import type { FusedTrackEventLike } from "../ingest/service/ingest.service";
import { loadAsterixFeedConfigs, type NamedFeedConfig } from "./asterix-config";

/** What a started feed must offer — satisfied by `AsterixFeedSource`. */
export interface RunnableFeed {
  readonly stats: IngestSourceStats;
  start(onEvent: (ev: IngestEvent) => void): void | Promise<void>;
  stop(): Promise<void>;
}

export interface FeedHandlers {
  /** Every decoded track, including `lifecycle: "dropped"`. Runs after persistence. */
  onTrack?: (event: FusedTrackEvent) => void;
  /** CAT23 ground-station status and similar. */
  onHealth?: (event: SourceHealthEvent) => void;
  /** AFTN found on a multiplexed ASTERIX stream. */
  onFlightPlan?: (event: FlightPlanEvent) => void;
}

export interface StartFeedsOptions {
  env?: Record<string, string | undefined>;
  handlers?: FeedHandlers;
  /** Where decoded tracks are stored (index.ts passes the shared ingest buffer). */
  persist: (event: FusedTrackEventLike) => void;
  /** Test seam. Default: `createFeedSource({ protocol: "asterix", ... })`. */
  createSource?: (feed: NamedFeedConfig) => RunnableFeed;
}

export interface FeedState {
  name: string;
  stats: IngestSourceStats;
  lastHealth: SourceHealthEvent["status"] | null;
}

interface Running {
  name: string;
  source: RunnableFeed;
  lastHealth: SourceHealthEvent["status"] | null;
}

let running: Running[] = [];

const isFused = (e: unknown): e is FusedTrackEvent =>
  typeof e === "object" && e !== null && "identity" in e && "trackId" in e;

function defaultCreateSource(feed: NamedFeedConfig): RunnableFeed {
  return createFeedSource({
    protocol: "asterix",
    ...feed.config,
  }) as unknown as RunnableFeed;
}

function safely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    // A failing consumer must never stop the radar feed.
    logger.error({ err }, `asterix feed: ${label} handler threw`);
  }
}

function route(
  entry: Running,
  ev: IngestEvent,
  handlers: FeedHandlers,
  persist: (event: FusedTrackEventLike) => void,
): void {
  switch (ev.kind) {
    case "track": {
      if (!isFused(ev.event)) return;
      const track = ev.event;
      safely("persist", () => persist({ ...track }));
      if (handlers.onTrack) {
        const fn = handlers.onTrack;
        safely("onTrack", () => fn(track));
      }
      return;
    }
    case "health": {
      const status = ev.event.status;
      if (entry.lastHealth !== status) {
        logger.info(
          {
            feed: entry.name,
            source: ev.event.sourceId,
            status,
            was: entry.lastHealth,
          },
          "asterix feed: ground station status changed",
        );
        entry.lastHealth = status;
      }
      if (handlers.onHealth) {
        const fn = handlers.onHealth;
        safely("onHealth", () => fn(ev.event));
      }
      return;
    }
    case "flightplan": {
      if (handlers.onFlightPlan) {
        const fn = handlers.onFlightPlan;
        safely("onFlightPlan", () => fn(ev.event));
      }
      return;
    }
    default:
      // raw field dumps, status and removal notices are not used here.
      return;
  }
}

/** Starts every configured ASTERIX feed (UDP and/or TCP). A no-op when none is
 *  configured — the HTTP/WS/Kafka ingest paths work independently of this. */
export function startAsterixFeeds(opts: StartFeedsOptions): void {
  if (running.length > 0) return;

  const { feeds, warnings } = loadAsterixFeedConfigs(opts.env ?? process.env);
  for (const w of warnings) logger.warn(w);
  if (feeds.length === 0) {
    logger.info(
      "no ASTERIX feed configured (AEROSWARM_FEED_UDP_PORT / ASTERIX_TCP_HOST+PORT) — direct feeds disabled",
    );
    return;
  }

  const handlers = opts.handlers ?? {};
  const persist = opts.persist;
  const create = opts.createSource ?? defaultCreateSource;

  for (const feed of feeds) {
    const entry: Running = {
      name: feed.name,
      source: create(feed),
      lastHealth: null,
    };
    running.push(entry);
    try {
      void Promise.resolve(
        entry.source.start((ev) => route(entry, ev, handlers, persist)),
      ).catch((err) =>
        logger.error({ err, feed: feed.name }, "asterix feed: failed to start"),
      );
    } catch (err) {
      logger.error({ err, feed: feed.name }, "asterix feed: failed to start");
    }
    logger.info(
      {
        feed: feed.name,
        transport: feed.config.transport,
        port: feed.config.port,
        host: feed.config.host,
        airport: feed.config.airportId ?? "unscoped",
        allowedCats: [...(feed.config.allowedCats ?? [])],
      },
      "asterix feed starting",
    );
  }
}

export async function stopAsterixFeeds(): Promise<void> {
  const stopping = running;
  running = [];
  await Promise.all(
    stopping.map((r) =>
      r.source
        .stop()
        .catch((err) =>
          logger.warn({ err, feed: r.name }, "asterix feed: stop failed"),
        ),
    ),
  );
}

export function getFeedStates(): FeedState[] {
  return running.map((r) => ({
    name: r.name,
    stats: r.source.stats,
    lastHealth: r.lastHealth,
  }));
}
