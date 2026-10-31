import {
  createKafkaSink,
  createWebhookSink,
  createWebSocketSink,
  type OutputConnector,
} from "@aeroswarm/connectors";
import { logger } from "@repo/logger";
import { surveillanceMetrics } from "./metrics";

const configured = (): OutputConnector[] => {
  const sinks: OutputConnector[] = [];
  const webhookUrl = process.env.AEROSWARM_OUTPUT_WEBHOOK_URL;
  const webhookSecret = process.env.AEROSWARM_OUTPUT_WEBHOOK_SECRET;
  if (webhookUrl) {
    sinks.push(
      createWebhookSink({
        url: webhookUrl,
        secret: webhookSecret,
        retries: 3,
        timeoutMs: 5_000,
      }),
    );
  }

  const brokers = process.env.AEROSWARM_OUTPUT_KAFKA_BROKERS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const topic = process.env.AEROSWARM_OUTPUT_KAFKA_TOPIC;
  if (brokers?.length && topic) sinks.push(createKafkaSink({ brokers, topic }));

  const websocketUrl = process.env.AEROSWARM_OUTPUT_WEBSOCKET_URL;
  if (websocketUrl) sinks.push(createWebSocketSink({ url: websocketUrl }));
  return sinks;
};

const sinks = configured();
let connectorErrors = 0;

export async function sendToConnectors(event: unknown): Promise<void> {
  const results = await Promise.allSettled(
    sinks.map((sink) => sink.send(event)),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      surveillanceMetrics.connectorSendErrors.inc();
      connectorErrors++;
      logger.error(
        { err: result.reason },
        "surveillance connector send failed",
      );
    }
  }
}

export async function flushConnectors(): Promise<void> {
  await Promise.allSettled(sinks.map((sink) => sink.flush()));
}

export async function closeConnectors(): Promise<void> {
  await Promise.allSettled(sinks.map((sink) => sink.close()));
}

export function connectorState(): { configured: number; errors: number } {
  return {
    configured: sinks.length,
    errors: connectorErrors,
  };
}
