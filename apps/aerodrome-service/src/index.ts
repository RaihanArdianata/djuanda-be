import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import { app } from "./app";
import { env } from "./config/env";
import {
  startAerodromeConsumer,
  stopAerodromeConsumer,
} from "./modules/messaging/aerodrome.consumer";
import {
  startAerodromeProducer,
  stopAerodromeProducer,
} from "./modules/messaging/aerodrome.producer";
import {
  startNotamExpirySweep,
  stopNotamExpirySweep,
} from "./modules/notam/notam-expiry.sweep";

const server = Bun.serve({
  port: env.AERODROME_SERVICE_PORT,
  fetch: app.fetch,
});

logger.info(
  `aerodrome-service listening on http://localhost:${env.AERODROME_SERVICE_PORT}`,
);

startAerodromeProducer();
void startAerodromeConsumer();
startNotamExpirySweep();

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down aerodrome-service gracefully`);
  stopNotamExpirySweep();
  await stopAerodromeProducer();
  await stopAerodromeConsumer();
  server.stop();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
