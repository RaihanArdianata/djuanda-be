import { app } from "./app";
import { pool } from "@repo/database";
import { logger } from "@repo/logger";

const port: string | number = process.env.ALERT_SERVICE_PORT || 3005;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

logger.info(`alert-service listening on http://localhost:${port}`);

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down alert-service gracefully`);
  server.stop();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
