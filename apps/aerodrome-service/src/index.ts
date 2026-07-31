import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import { app } from "./app";

const port: string | number = process.env.AERODROME_SERVICE || 3009;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

logger.info(`aerodrome-service listening on http://localhost:${port}`);

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down aerodrome-service gracefully`);
  server.stop();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
