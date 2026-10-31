import { describe, expect, it } from "bun:test";
import { registry } from "@repo/shared/metrics";
import {
  type FeedPacketStats,
  feedMetrics,
  type LiveStats,
  registerStatMetrics,
} from "./feed-metrics";

const feeds: FeedPacketStats[] = [
  { packetsReceived: 10, packetsUndecoded: 1 },
  { packetsReceived: 5, packetsUndecoded: 0 },
];
const live: LiveStats = { clients: 3, messagesSent: 40, deltasSkipped: 2 };

async function value(name: string): Promise<number | undefined> {
  const metrics = await registry.getMetricsAsJSON();
  return metrics.find((m) => m.name === name)?.values[0]?.value;
}

describe("feed metrics", () => {
  registerStatMetrics({ feeds: () => feeds, live: () => live });

  it("registers every metric name the dashboards rely on", async () => {
    const names = new Set(
      (await registry.getMetricsAsJSON()).map((m) => m.name),
    );
    for (const name of [
      "asterix_packets_received_total",
      "asterix_packets_undecoded_total",
      "asterix_tracks_decoded_total",
      "asterix_tracks_persisted_total",
      "aftn_messages_received_total",
      "aftn_flightplans_persisted_total",
      "source_health_events_total",
      "websocket_clients",
      "websocket_messages_sent_total",
      "websocket_updates_dropped_total",
      "db_write_errors_total",
    ]) {
      expect(names.has(name)).toBe(true);
    }
  });

  it("reads packet and websocket numbers from the stats at scrape time", async () => {
    expect(await value("asterix_packets_received_total")).toBe(15);
    expect(await value("asterix_packets_undecoded_total")).toBe(1);
    expect(await value("websocket_clients")).toBe(3);
    expect(await value("websocket_messages_sent_total")).toBe(40);
    expect(await value("websocket_updates_dropped_total")).toBe(2);
  });

  it("adds only the growth since the previous scrape", async () => {
    const first = feeds[0] as FeedPacketStats;
    first.packetsReceived = 25;
    expect(await value("asterix_packets_received_total")).toBe(30);
    expect(await value("asterix_packets_received_total")).toBe(30);
  });

  it("counts a feed that restarted from zero as new traffic", async () => {
    const first = feeds[0] as FeedPacketStats;
    const second = feeds[1] as FeedPacketStats;
    first.packetsReceived = 0;
    second.packetsReceived = 0;
    expect(await value("asterix_packets_received_total")).toBe(30);
    first.packetsReceived = 4;
    expect(await value("asterix_packets_received_total")).toBe(34);
  });

  it("counts events incremented by the pipeline", async () => {
    const before = (await value("asterix_tracks_decoded_total")) ?? 0;
    feedMetrics.tracksDecoded.inc();
    expect(await value("asterix_tracks_decoded_total")).toBe(before + 1);
  });
});
