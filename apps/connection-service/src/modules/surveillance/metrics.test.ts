import { describe, expect, it } from "bun:test";
import { registry } from "@repo/shared/metrics";
import "./metrics";

const required = [
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
  "connector_send_errors_total",
];

describe("surveillance metrics", () => {
  it("registers the required metric names", async () => {
    const metrics = await registry.getMetricsAsJSON();
    const names = new Set(metrics.map((metric) => metric.name));
    expect(required.every((name) => names.has(name))).toBe(true);
  });
});
