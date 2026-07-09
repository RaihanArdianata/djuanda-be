import { Hono } from 'hono';
import { websocket, serveStatic } from 'hono/bun';
import { logger } from 'hono/logger';
import { errorHandler, metricsMiddleware, metricsHandler } from '@repo/shared';
import { join } from 'path';
import routes from './routes';
import { wsHandler } from './websocket';
import { sseHandler } from './sse';

const app = new Hono()
  .use(logger())
  .use(metricsMiddleware)
  .get('/metrics', metricsHandler)
  .use('/public/*', async (c) => {
    const publicPath = join(process.cwd(), 'public');
    const filePath = join(publicPath, c.req.path.replace('/public/', ''));
    return new Response(Bun.file(filePath));
  })
  .use(
    '/file-data/*',
    serveStatic({
      root: './public',
      rewriteRequestPath: (path) => path.replace('/file-data/', ''),
    })
  )
  .get('/ws/:topic', wsHandler)
  .get('/sse/:topic', sseHandler)
  .route('/', routes)
  .onError(errorHandler);

export { app, websocket };
export type AppType = typeof app;
