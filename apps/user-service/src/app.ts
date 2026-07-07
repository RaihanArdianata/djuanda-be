import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { metricsMiddleware, metricsHandler } from '@repo/shared';
import health from './routes/health';

const app = new Hono()
  .use(logger())
  .use(metricsMiddleware)
  .get('/metrics', metricsHandler)
  .route('/health', health);

export { app };
export type AppType = typeof app;
