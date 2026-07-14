import { metricsHandler, metricsMiddleware } from '@repo/shared';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { websocket } from 'hono/bun';
import health from './routes/health';
import { sseHandler } from './sse';
import { wsHandler } from './websocket';

const app = new Hono().use(logger()).use(metricsMiddleware).get('/metrics', metricsHandler).route('/health', health).get('/ws/:topic', wsHandler).get('/sse/:topic', sseHandler);

export { app, websocket };
export default app;
