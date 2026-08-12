import { logger } from "@repo/logger";
import { app } from "./app";

const port: string | number = process.env.ADVISORY_SERVICE_PORT || 3007;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

logger.info(`advisory-service listening on http://localhost:${port}`);

const shutdown = (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down advisory-service gracefully`);
  server.stop();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
