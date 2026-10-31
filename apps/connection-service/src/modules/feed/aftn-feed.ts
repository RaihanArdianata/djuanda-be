import type { FlightPlanEvent } from "@aeroswarm/core";
import {
  createFeedSource,
  type IngestEvent,
  type IngestSourceStats,
} from "@aeroswarm/ingest";
import { logger } from "@repo/logger";
import { loadAftnFeedConfigs, type NamedAftnFeed } from "./aftn-config";

/** What a started feed must offer — satisfied by `AftnFeedSource`. */
export interface RunnableAftnFeed {
  readonly stats: IngestSourceStats;
  start(onEvent: (ev: IngestEvent) => void): void | Promise<void>;
  stop(): Promise<void>;
}

export interface StartAftnFeedsOptions {
  env?: Record<string, string | undefined>;
  /** Called for every parsed AFTN/ATS message, e.g. `plans.apply`. */
  onFlightPlan: (event: FlightPlanEvent) => void;
  /** Called after `onFlightPlan`, e.g. forward to Kafka. Failures are logged, never fatal. */
  publish?: (event: FlightPlanEvent) => void | Promise<void>;
  /** Test seam. Default: `createFeedSource({ protocol: "aftn", ... })`. */
  createSource?: (feed: NamedAftnFeed) => RunnableAftnFeed;
}

export interface AftnFeedState {
  name: string;
  stats: IngestSourceStats;
}

interface Running {
  name: string;
  source: RunnableAftnFeed;
}

let running: Running[] = [];

function defaultCreateSource(feed: NamedAftnFeed): RunnableAftnFeed {
  return createFeedSource({
    protocol: "aftn",
    ...feed.config,
  }) as unknown as RunnableAftnFeed;
}

function deliver(
  feedName: string,
  event: FlightPlanEvent,
  opts: StartAftnFeedsOptions,
): void {
  try {
    opts.onFlightPlan(event);
  } catch (err) {
    // A failing consumer must never stop the AFTN feed.
    logger.error({ err, feed: feedName }, "aftn feed: onFlightPlan threw");
  }
  if (!opts.publish) return;
  try {
    Promise.resolve(opts.publish(event)).catch((err: unknown) =>
      logger.warn({ err, feed: feedName }, "aftn feed: publish failed"),
    );
  } catch (err) {
    logger.warn({ err, feed: feedName }, "aftn feed: publish failed");
  }
}

/** Starts every configured AFTN feed (UDP and/or TCP). A no-op when none is configured. */
export function startAftnFeeds(opts: StartAftnFeedsOptions): void {
  if (running.length > 0) return;

  const { feeds, warnings } = loadAftnFeedConfigs(opts.env ?? process.env);
  for (const w of warnings) logger.warn(w);
  if (feeds.length === 0) {
    logger.info(
      "no AFTN feed configured (AFTN_FEED_UDP_PORT / AFTN_TCP_HOST+PORT / AFTN_FEEDS) — direct AFTN disabled",
    );
    return;
  }

  const create = opts.createSource ?? defaultCreateSource;
  for (const feed of feeds) {
    const entry: Running = { name: feed.name, source: create(feed) };
    running.push(entry);
    const onEvent = (ev: IngestEvent): void => {
      if (ev.kind === "flightplan") deliver(entry.name, ev.event, opts);
    };
    try {
      void Promise.resolve(entry.source.start(onEvent)).catch((err) =>
        logger.error({ err, feed: feed.name }, "aftn feed: failed to start"),
      );
    } catch (err) {
      logger.error({ err, feed: feed.name }, "aftn feed: failed to start");
    }
    logger.info(
      {
        feed: feed.name,
        transport: feed.config.transport,
        port: feed.config.port,
        host: feed.config.host,
        airport: feed.config.airportId ?? "unscoped",
      },
      "aftn feed starting",
    );
  }
}

export async function stopAftnFeeds(): Promise<void> {
  const stopping = running;
  running = [];
  await Promise.all(
    stopping.map((r) =>
      r.source
        .stop()
        .catch((err) =>
          logger.warn({ err, feed: r.name }, "aftn feed: stop failed"),
        ),
    ),
  );
}

export function getAftnFeedStates(): AftnFeedState[] {
  return running.map((r) => ({ name: r.name, stats: r.source.stats }));
}
