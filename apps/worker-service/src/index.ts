import { pool } from '@repo/database';
import { logger } from '@repo/logger';
import app, { websocket } from './app';

const port: string | number = process.env.WORKER_SERVICE_PORT || 3003;

const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket,
});

logger.info(`worker-service listening on http://localhost:${port}`);

const shutdown = async (signal: string): Promise<never> => {
  logger.info(`${signal} received, shutting down worker-service gracefully`);
  server.stop();
  await pool.end();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
