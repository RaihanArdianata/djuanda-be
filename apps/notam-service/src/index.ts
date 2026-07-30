import { logger } from "@repo/logger";
import { app } from "./app";

const port: string | number = process.env.NOTAM_ASHTAM_SERVICE_PORT || 3007;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

logger.info(`notam-service listening on http://localhost:${port}`);

const shutdown = (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down notam-service gracefully`);
  server.stop();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
