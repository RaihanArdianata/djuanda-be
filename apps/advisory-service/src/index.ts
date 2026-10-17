import { logger } from "@repo/logger";
import { app } from "./app";
import { env } from "./config/env";
import {
  startAdvisoryProducer,
  stopAdvisoryProducer,
} from "./modules/messaging/advisory.producer";
import {
  startAeroswarmFlightPlanConsumer,
  stopAeroswarmFlightPlanConsumer,
} from "./modules/messaging/aeroswarm.consumer";
import {
  startAshtamSync,
  stopAshtamSync,
} from "./modules/scheduler/ashtam.sync.loop";
import {
  startNotamSync,
  stopNotamSync,
} from "./modules/scheduler/notam.sync.loop";

const port: string | number = env.ADVISORY_SERVICE_PORT;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

startAdvisoryProducer();
startAeroswarmFlightPlanConsumer();
startAshtamSync();
startNotamSync();

logger.info(`advisory-service listening on http://localhost:${port}`);

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down advisory-service gracefully`);
  stopAshtamSync();
  stopNotamSync();
  await stopAeroswarmFlightPlanConsumer();
  await stopAdvisoryProducer();
  server.stop();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
