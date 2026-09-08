import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import { app } from "./app";
import {
  startMovementConsumer,
  stopMovementConsumer,
} from "./modules/messaging/movement.consumer";
import { closeRealtimePublisher } from "./modules/messaging/redis-publisher";

const port: string | number = process.env.STATISTICS_SERVICE_PORT || 3010;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

logger.info(`statistics-service listening on http://localhost:${port}`);

startMovementConsumer().catch((err) => {
  logger.error(
    { err },
    "movement consumer failed to start — existing statistics API is unaffected",
  );
});

const shutdown = async (signal: string): Promise<never> => {
  logger.info(
    `${signal} received, shutting down statistics-service gracefully`,
  );
  server.stop();
  await stopMovementConsumer();
  await closeRealtimePublisher();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
