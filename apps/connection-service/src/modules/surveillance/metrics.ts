import { createCounter, createGauge } from "@repo/shared/metrics";

export const surveillanceMetrics = {
  asterixPacketsReceived: createCounter(
    "asterix_packets_received_total",
    "ASTERIX packets received",
  ),
  asterixPacketsUndecoded: createCounter(
    "asterix_packets_undecoded_total",
    "ASTERIX packets that produced no decoded records",
  ),
  asterixTracksDecoded: createCounter(
    "asterix_tracks_decoded_total",
    "ASTERIX track events decoded",
  ),
  asterixTracksPersisted: createCounter(
    "asterix_tracks_persisted_total",
    "ASTERIX tracks persisted",
  ),
  aftnMessagesReceived: createCounter(
    "aftn_messages_received_total",
    "AFTN messages received",
  ),
  aftnFlightplansPersisted: createCounter(
    "aftn_flightplans_persisted_total",
    "AFTN flight plans persisted",
  ),
  sourceHealthEvents: createCounter(
    "source_health_events_total",
    "Source health events received",
  ),
  websocketMessagesSent: createCounter(
    "websocket_messages_sent_total",
    "Live WebSocket messages sent",
  ),
  websocketUpdatesDropped: createCounter(
    "websocket_updates_dropped_total",
    "Live WebSocket updates dropped by backpressure",
  ),
  dbWriteErrors: createCounter(
    "db_write_errors_total",
    "Surveillance database write errors",
  ),
  connectorSendErrors: createCounter(
    "connector_send_errors_total",
    "Output connector send errors",
  ),
};

export const websocketClients = createGauge(
  "websocket_clients",
  "Connected live WebSocket clients",
);
