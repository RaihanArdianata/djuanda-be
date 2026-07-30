import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import { app } from "./app";
import {
  startWeatherPolling,
  stopWeatherPolling,
} from "./modules/weather/services/weather-poller";

const port: string | number = process.env.WEATHER_SERVICE_PORT || 3008;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

logger.info(`weather-service listening on http://localhost:${port}`);

startWeatherPolling();

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down weather-service gracefully`);
  stopWeatherPolling();
  server.stop();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));