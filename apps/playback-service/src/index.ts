import { pool } from "@repo/database";
import { logger } from "@repo/logger";
import app from "./app";
import {
  getMaxImportBytes,
  MULTIPART_OVERHEAD_BYTES,
} from "./modules/files/playback-files.import";
import { closePlaybackFileQueue } from "./modules/files/playback-files.queue";
import { playbackFileWorker } from "./modules/files/playback-files.worker";

const port: string | number = process.env.PLAYBACK_SERVICE_PORT || 3011;

const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 255,
  maxRequestBodySize: getMaxImportBytes() + MULTIPART_OVERHEAD_BYTES,
});

logger.info(`playback-service listening on http://localhost:${port}`);
const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down playback-service gracefully`);
  server.stop();
  await playbackFileWorker.close();
  await closePlaybackFileQueue();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export * from "./modules/ws/ws.handler";
