import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import { app } from "./app";
import { env } from "./config/env";
import {
  startAerodromeProducer,
  stopAerodromeProducer,
} from "./modules/messaging/aerodrome.producer";

const server = Bun.serve({
  port: env.AERODROME_SERVICE_PORT,
  fetch: app.fetch,
});

logger.info(
  `aerodrome-service listening on http://localhost:${env.AERODROME_SERVICE_PORT}`,
);

startAerodromeProducer();

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down aerodrome-service gracefully`);
  await stopAerodromeProducer();
  server.stop();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
