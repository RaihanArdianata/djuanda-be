import { logger } from "@repo/logger";
import { app } from "./app";
import { env } from "./config/env";
import {
  startAdvisoryProducer,
  stopAdvisoryProducer,
} from "./modules/messaging/advisory.producer";
import { startAshtamSync } from "./modules/scheduler/ashtam.sync.loop";
import {
  startAdvisorySync,
  stopAdvisorySync,
} from "./modules/scheduler/sync.loop";

const port: string | number = env.ADVISORY_SERVICE_PORT;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

startAdvisoryProducer();
startAdvisorySync();
startAshtamSync();

logger.info(`advisory-service listening on http://localhost:${port}`);

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down advisory-service gracefully`);
  stopAdvisorySync();
  await stopAdvisoryProducer();
  server.stop();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
