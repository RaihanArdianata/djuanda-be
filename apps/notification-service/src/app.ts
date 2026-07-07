import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { errorHandler, metricsMiddleware, metricsHandler } from '@repo/shared';
import routes from './routes';

const app = new Hono()
  .use(logger())
  .use(metricsMiddleware)
  .get('/metrics', metricsHandler)
  .route('/', routes)
  .onError(errorHandler);

export { app };
export type AppType = typeof app;
