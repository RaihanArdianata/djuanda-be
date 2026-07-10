import { logger } from "@repo/logger";
import { app } from "./app";
import { env } from "./config/env";

const server = Bun.serve({
  port: env.PORT,
  fetch: app.fetch,
});

logger.info(`gateway listening on http://localhost:${env.PORT}`);

const shutdown = (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down gateway gracefully`);
  server.stop();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
