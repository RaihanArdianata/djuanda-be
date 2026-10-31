import { createCounter, createGauge } from "@repo/shared/metrics";

/** Counted where the event happens (see index.ts). */
export const feedMetrics = {
  tracksDecoded: createCounter(
    "asterix_tracks_decoded_total",
    "ASTERIX track events decoded",
  ),
  tracksPersisted: createCounter(
    "asterix_tracks_persisted_total",
    "ASTERIX tracks accepted into the ingest buffer for storage",
  ),
  aftnMessagesReceived: createCounter(
    "aftn_messages_received_total",
    "AFTN flight plan messages received",
  ),
  aftnFlightplansPersisted: createCounter(
    "aftn_flightplans_persisted_total",
    "AFTN flight plans forwarded to Kafka for advisory-service",
  ),
  sourceHealthEvents: createCounter(
    "source_health_events_total",
    "Ground-station status events received",
  ),
  dbWriteErrors: createCounter(
    "db_write_errors_total",
    "Tracks that could not be queued for storage",
  ),
};

export interface FeedPacketStats {
  packetsReceived: number;
  packetsUndecoded: number;
}

export interface LiveStats {
  clients: number;
  messagesSent: number;
  deltasSkipped: number;
}

export interface StatSources {
  /** Per-feed packet counters from the ingest package. */
  feeds(): FeedPacketStats[];
  live(): LiveStats;
}

/** A counter that follows a number which only ever grows elsewhere. */
function followCounter(name: string, help: string, read: () => number): void {
  let last = 0;
  createCounter(name, help, function collect(): void {
    const now = read();
    // A restarted feed starts again from zero: count that as new traffic.
    this.inc(now >= last ? now - last : now);
    last = now;
  });
}

const sum = (xs: FeedPacketStats[], pick: keyof FeedPacketStats): number =>
  xs.reduce((total, x) => total + x[pick], 0);

let registered = false;

/**
 * Metrics whose values the ingest and live-server packages already keep.
 * They are read when Prometheus scrapes, so nothing has to be incremented on
 * the hot path. Call once at startup.
 */
export function registerStatMetrics(src: StatSources): void {
  if (registered) return;
  registered = true;
  followCounter(
    "asterix_packets_received_total",
    "ASTERIX datagrams received, all feeds",
    () => sum(src.feeds(), "packetsReceived"),
  );
  followCounter(
    "asterix_packets_undecoded_total",
    "ASTERIX datagrams that produced no decoded records, all feeds",
    () => sum(src.feeds(), "packetsUndecoded"),
  );
  followCounter(
    "websocket_messages_sent_total",
    "Live WebSocket messages sent",
    () => src.live().messagesSent,
  );
  followCounter(
    "websocket_updates_dropped_total",
    "Live WebSocket updates skipped by the per-client rate limit",
    () => src.live().deltasSkipped,
  );
  createGauge(
    "websocket_clients",
    "Connected live WebSocket clients",
    function collect(): void {
      this.set(src.live().clients);
    },
  );
}
