import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import app from "./app";

const port: string | number = process.env.PLAYBACK_SERVICE_PORT || 3011;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

logger.info(`playback-service listening on http://localhost:${port}`);

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down playback-service gracefully`);
  server.stop();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export * from "./modules/ws/ws.handler";
