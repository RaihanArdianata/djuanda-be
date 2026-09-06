import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import { app } from "./app";
import {
  startAdvisoryConsumer,
  stopAdvisoryConsumer,
} from "./modules/messaging/advisory.consumer";
import {
  startAerodromeConsumer,
  stopAerodromeConsumer,
} from "./modules/messaging/aerodrome.consumer";
import {
  startAlertProducer,
  stopAlertProducer,
} from "./modules/messaging/alert.producer";
import {
  startTrackConsumer,
  stopTrackConsumer,
} from "./modules/messaging/track.consumer";
import {
  startWeatherConsumer,
  stopWeatherConsumer,
} from "./modules/messaging/weather.consumer";
import { redis } from "./redis/client";

const port: string | number = process.env.ALERT_SERVICE_PORT || 3006;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

logger.info(`alert-service listening on http://localhost:${port}`);

await startAlertProducer();
await startAdvisoryConsumer();
await startWeatherConsumer();
await startAerodromeConsumer();
await startTrackConsumer();

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down alert-service gracefully`);
  server.stop();
  await stopTrackConsumer();
  await stopAerodromeConsumer();
  await stopWeatherConsumer();
  await stopAdvisoryConsumer();
  await stopAlertProducer();
  redis.disconnect();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
